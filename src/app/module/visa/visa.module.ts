import { Module } from '@nestjs/common';
import { VisaService } from './visa.service';
import { VisaController } from './visa.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Visa, VisaSchema } from './entities/visa.entity';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Visa.name, schema: VisaSchema }]),
  ],
  controllers: [VisaController],
  providers: [VisaService],
})
export class VisaModule {}
