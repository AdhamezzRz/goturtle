import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access } from '../../common/decorators';
import { ForecastingService } from './forecasting.service';
import { AccuracyQueryDto, DemandQueryDto } from './forecasting.dto';

@ApiTags('Forecasting')
@ApiBearerAuth()
@Controller({ path: 'forecast', version: '1' })
export class ForecastingController {
  constructor(private readonly forecasting: ForecastingService) {}

  @Access({ actors: ['staff'], permissions: ['shifts.read'] })
  @Get('demand')
  @ApiOperation({ summary: 'Daily order forecast (weekday-weighted 8-week average + trend + events, 80% interval) per hub/zone, with staffing gaps' })
  demand(@Query() q: DemandQueryDto) {
    return this.forecasting.demand(q);
  }

  @Access({ actors: ['staff'], permissions: ['shifts.read'] })
  @Get('accuracy')
  @ApiOperation({ summary: 'Backtest of the last N weeks (one-week-ahead forecasts): MAPE, WAPE, interval coverage' })
  accuracy(@Query() q: AccuracyQueryDto) {
    return this.forecasting.accuracy(q);
  }
}
