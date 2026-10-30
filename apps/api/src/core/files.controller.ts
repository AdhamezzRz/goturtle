import { BadRequestException, Controller, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { Access, CurrentPrincipal, Public } from '../common/decorators';
import { principalUserId, type Principal } from '../common/principal';
import { config } from '../config';
import { FILE_PURPOSES, StorageService, type FilePurpose } from './storage.service';

@ApiTags('Files')
@Controller({ path: 'files', version: '1' })
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Access({ actors: ['staff', 'brand', 'courier', 'customer', 'apiKey'] })
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024 } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Query('purpose') purpose: string, @CurrentPrincipal() p: Principal) {
    if (!file) throw new BadRequestException('file is required (multipart field "file")');
    if (!FILE_PURPOSES.includes(purpose as FilePurpose)) throw new BadRequestException(`purpose must be one of ${FILE_PURPOSES.join(', ')}`);
    return this.storage.put(file.buffer, file.mimetype, purpose as FilePurpose, principalUserId(p));
  }

  /** Keys are unguessable (≈130 bits), so files can be linked from labels, emails and the tracking page. */
  @Public()
  @Get(':purpose/:month/:name')
  async download(@Param('purpose') purpose: string, @Param('month') month: string, @Param('name') name: string, @Res() res: Response) {
    const file = await this.storage.get(`${purpose}/${month}/${name}`);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.buffer);
  }
}
