// consultation.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { ConsultationService } from './consultation.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';
import AuthGuard from 'src/app/middlewares/auth.guard';
import type { Request } from 'express';

@ApiTags('Consultation')
@Controller('consultation')
export class ConsultationController {
  constructor(private readonly consultationService: ConsultationService) {}

  // ✅ Public: anyone can book
  @Post()
  @ApiOperation({ summary: 'Book a consultation (public)' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('user'))
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: Request,
    @Body() createConsultationDto: CreateConsultationDto,
  ) {
    const userId = req.user!.id;
    const result = await this.consultationService.create(
      userId,
      createConsultationDto,
    );
    return { message: 'Consultation booked successfully', data: result };
  }

  // ✅ Admin: get all consultations
  @Get()
  @ApiOperation({ summary: 'Get all consultations (admin)' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'paymentStatus', required: false })
  @ApiQuery({ name: 'type', required: false })
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() query: any) {
    const result = await this.consultationService.findAll(query);
    return { message: 'Consultations fetched successfully', data: result };
  }

  // ✅ User: get own consultations
  @Get('my')
  @ApiOperation({ summary: 'Get my consultations (logged in user)' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('user'))
  @HttpCode(HttpStatus.OK)
  async findMyConsultations(@Req() req: Request) {
    const userId = (req as any).user.id;
    const result = await this.consultationService.findByUser(userId);
    return { message: 'Your consultations fetched', data: result };
  }

  // ✅ Admin: get single
  @Get(':id')
  @ApiOperation({ summary: 'Get single consultation (admin)' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    const result = await this.consultationService.findOne(id);
    return { message: 'Consultation fetched', data: result };
  }

  // ✅ Admin: update (approve payment, confirm, add meeting link)
  @Put(':id')
  @ApiOperation({ summary: 'Update consultation (admin)' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() dto: UpdateConsultationDto) {
    const result = await this.consultationService.update(id, dto);
    return { message: 'Consultation updated successfully', data: result };
  }

  // ✅ Admin: delete
  @Delete(':id')
  @ApiOperation({ summary: 'Delete consultation (admin)' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    const result = await this.consultationService.remove(id);
    return { message: 'Consultation deleted successfully', data: result };
  }

  //admin: approve
  @Put(':id/approve')
  @ApiOperation({ summary: 'Approve consultation (admin)' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @HttpCode(HttpStatus.OK)
  async approve(@Param('id') id: string) {
    const result = await this.consultationService.approveConsultation(id);
    return { message: 'Consultation approved successfully', data: result };
  }

  // Admin: Reject consultation
  @Delete(':id/reject')
  @ApiOperation({ summary: 'Reject consultation (admin)' })
  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('admin'))
  @HttpCode(HttpStatus.OK)
  async reject(@Param('id') id: string) {
    const result = await this.consultationService.rejectConsultation(id);
    return { message: 'Consultation rejected successfully', data: result };
  }
}
