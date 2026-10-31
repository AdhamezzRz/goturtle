import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { BrandSelfController, BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';

@Module({
  imports: [UsersModule],
  // Order matters: /brands/me… must be registered before /brands/:id….
  controllers: [BrandSelfController, BrandsController],
  providers: [BrandsService],
  exports: [BrandsService],
})
export class BrandsModule {}
