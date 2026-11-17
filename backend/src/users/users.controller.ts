import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserResponseEntity } from './entities/user-response.entity';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  async getProfile(@Param('id') id: string): Promise<UserResponseEntity> {
    const user = await this.usersService.findById(id);
    return new UserResponseEntity(user);
  }

  @Patch(':id/customization')
  async updateCustomization(
    @Param('id') id: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseEntity> {
    const user = await this.usersService.updateCustomization(id, dto);
    return new UserResponseEntity(user);
  }
}
