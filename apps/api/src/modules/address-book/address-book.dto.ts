import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AddressSuggestQuery {
  @ApiProperty({ example: '01001234567' }) @IsString() @MinLength(8) @MaxLength(20) phone!: string;
}
