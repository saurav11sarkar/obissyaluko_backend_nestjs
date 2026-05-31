import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
} from 'class-validator';
import {
  ConsultationType,
  Duration,
  PaymentStatus,
} from '../entities/consultation.entity';

export class CreateConsultationDto {
  @ApiProperty({ example: 'Saurav Sarkar' })
  @IsString()
  @IsNotEmpty()
  clientName: string;

  @ApiProperty({ example: 'saurav@gmail.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ example: '+8801700000000' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ enum: ConsultationType, example: ConsultationType.VISA })
  @IsEnum(ConsultationType)
  type: ConsultationType;

  @ApiPropertyOptional({ enum: Duration, example: Duration.THIRTY_MIN })
  @IsOptional()
  @IsEnum(Duration)
  duration?: Duration;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => Number(value))
  fee?: number;

  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  preferredDate: string;

  @ApiProperty({ example: '09:00 AM' })
  @IsString()
  @IsNotEmpty()
  preferredTime: string;

  @ApiPropertyOptional({ example: 'I want to know about UK visa requirements' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({ enum: PaymentStatus, example: PaymentStatus.FREE })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;
  
}
