// consultation.service.ts
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Consultation,
  ConsultationDocument,
  ConsultationStatus,
  PaymentStatus,
} from './entities/consultation.entity';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';
import Stripe from 'stripe';
import config from 'src/app/config';
import { Payment, PaymentDocument } from '../payment/entities/payment.entity';
import { User, UserDocument } from '../user/entities/user.entity';

@Injectable()
export class ConsultationService {
  private readonly stripe?: Stripe;

  constructor(
    @InjectModel(Consultation.name)
    private readonly consultationModel: Model<ConsultationDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {
    if (config.stripe.secretKey) {
      this.stripe = new Stripe(config.stripe.secretKey);
    }
  }

  private getStripeClient() {
    if (!this.stripe) {
      throw new HttpException('Stripe is not configured', 500);
    }

    return this.stripe;
  }

  // User: book consultation
  async create(userId: string, createConsultationDto: CreateConsultationDto) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }
    const result = await this.consultationModel.create({
      ...createConsultationDto,
      userId,
    });
    return result;
  }

  // Admin: get all with optional filters
  async findAll(query: any = {}) {
    const filter: any = {};

    if (query.status) filter.status = query.status;
    if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
    if (query.type) filter.type = query.type;

    const consultations = await this.consultationModel
      .find(filter)
      .sort({ createdAt: -1 });

    return consultations;
  }

  // User: get own consultations
  async findByUser(userId: string) {
    return this.consultationModel.find({ userId }).sort({ createdAt: -1 });
  }

  // Get single
  async findOne(id: string) {
    const consultation = await this.consultationModel.findById(id);
    if (!consultation) {
      throw new HttpException('Consultation not found', HttpStatus.NOT_FOUND);
    }
    return consultation;
  }

  // Admin: update (status, meetingLink, notes, paymentStatus)
  async update(id: string, dto: UpdateConsultationDto) {
    const consultation = await this.consultationModel.findById(id);
    if (!consultation) {
      throw new HttpException('Consultation not found', HttpStatus.NOT_FOUND);
    }

    // Only update defined fields
    const updatePayload: Partial<UpdateConsultationDto> = {};
    for (const key of Object.keys(dto) as (keyof UpdateConsultationDto)[]) {
      if (dto[key] !== undefined) {
        (updatePayload as any)[key] = dto[key];
      }
    }

    const updated = await this.consultationModel.findByIdAndUpdate(
      id,
      { $set: updatePayload },
      { new: true },
    );
    return updated;
  }

  // Admin: delete
  async remove(id: string) {
    const consultation = await this.consultationModel.findById(id);
    if (!consultation) {
      throw new HttpException('Consultation not found', HttpStatus.NOT_FOUND);
    }
    return this.consultationModel.findByIdAndDelete(id);
  }

  async approveConsultation(id: string) {
    const consultation = await this.consultationModel.findById(id);
    if (!consultation) {
      throw new HttpException('Consultation not found', HttpStatus.NOT_FOUND);
    }
    if (
      consultation.fee > 0 &&
      consultation.paymentStatus !== PaymentStatus.PAID
    ) {
      throw new HttpException(
        'Cannot approve: payment not completed yet',
        HttpStatus.BAD_REQUEST,
      );
    }
    consultation.status = ConsultationStatus.CONFIRMED;
    consultation.adminStatus = 'approved';
    await consultation.save();

    return consultation;
  }

  // Admin: Reject
  async rejectConsultation(id: string) {
    const consultation = await this.consultationModel.findById(id);
    if (!consultation) {
      throw new HttpException('Consultation not found', HttpStatus.NOT_FOUND);
    }
    if (
      consultation.fee > 0 &&
      consultation.paymentStatus === PaymentStatus.PAID
    ) {
      const payment = await this.paymentModel.findOne({
        consultation: consultation._id,
        status: 'completed',
      });

      if (payment && payment.stripePaymentIntentId) {
        try {
          const stripe = this.getStripeClient();

          await stripe.refunds.create({
            payment_intent: payment.stripePaymentIntentId,
          });

          payment.status = 'refunded';
          await payment.save();

          consultation.paymentStatus = PaymentStatus.FREE;
        } catch (err: any) {
          throw new HttpException(
            `Refund failed: ${err.message}`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
      }
    }

    consultation.status = ConsultationStatus.CANCELLED;
    consultation.adminStatus = 'rejected';
    await consultation.save();

    return consultation;
  }
}
