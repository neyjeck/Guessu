import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { User } from '@prisma/client';
import { Request } from 'express';
import { diskStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserResponseEntity } from './entities/user-response.entity';
import { UsersService } from './users.service';

interface AuthenticatedRequest extends Request {
  user: User;
}

const AVATAR_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'avatars');
const MAX_AVATAR_BYTES = 3 * 1024 * 1024; // 3MB
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function ensureAvatarDirExists(): void {
  if (!fs.existsSync(AVATAR_UPLOAD_DIR)) {
    fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() req: AuthenticatedRequest): Promise<UserResponseEntity> {
    const user = await this.usersService.findById(req.user.id);
    return new UserResponseEntity(user);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseEntity> {
    const updated = await this.usersService.updateMyProfile(req.user.id, dto);
    return new UserResponseEntity(updated);
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: {
        fileSize: MAX_AVATAR_BYTES,
        files: 1,
      },
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          try {
            ensureAvatarDirExists();
            cb(null, AVATAR_UPLOAD_DIR);
          } catch (err) {
            cb(err as Error, AVATAR_UPLOAD_DIR);
          }
        },
        filename: (req, file, cb) => {
          const authReq = req as AuthenticatedRequest;
          const userId = authReq.user?.id ?? 'user';
          const rawExt = path.extname(file.originalname || '').toLowerCase();
          const safeExt = ALLOWED_EXTENSIONS.has(rawExt)
            ? rawExt === '.jpeg'
              ? '.jpg'
              : rawExt
            : file.mimetype === 'image/png'
              ? '.png'
              : file.mimetype === 'image/webp'
                ? '.webp'
                : '.jpg';
          const uniqueName = `${userId}-${Date.now()}-${randomUUID().slice(0, 8)}${safeExt}`;
          cb(null, uniqueName);
        },
      }),
      fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const mimeOk = ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase());
        const extOk = ext === '' || ALLOWED_EXTENSIONS.has(ext);
        if (!mimeOk || !extOk) {
          cb(
            new BadRequestException(
              'Only JPG, PNG, and WEBP image files (up to 3MB) are allowed.',
            ),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadAvatar(
    @Req() req: AuthenticatedRequest,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<UserResponseEntity> {
    const file = files?.[0];
    if (!file) {
      throw new BadRequestException(
        'Please attach an image file (jpg, png, or webp, max 3MB).',
      );
    }

    const avatarUrl = `/uploads/avatars/${file.filename}`;
    const updated = await this.usersService.updateAvatarUrl(
      req.user.id,
      avatarUrl,
    );
    return new UserResponseEntity(updated);
  }

  @Get(':id')
  async getProfile(@Param('id') id: string): Promise<UserResponseEntity> {
    const user = await this.usersService.findPublicProfileById(id);
    return new UserResponseEntity(user);
  }

  @Patch(':id/customization')
  @UseGuards(JwtAuthGuard)
  async updateCustomization(
    @Param('id') id: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseEntity> {
    const user = await this.usersService.updateCustomization(id, dto);
    return new UserResponseEntity(user);
  }
}
