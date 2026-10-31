import { Module } from '@nestjs/common';
import { BrandTeamController, UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [BrandTeamController, UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
