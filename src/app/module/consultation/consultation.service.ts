// consultation.service.ts
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
      paymentStatus: PaymentStatus.FREE,
    });
    return result;
  }

  private async syncStripePayment(consultation: ConsultationDocument) {
    if (consultation.paymentStatus === PaymentStatus.REFUNDED) {
      return;
    }

    const payment = await this.paymentModel.findOne({
      consultation: consultation._id,
      status: { $in: ['pending', 'authorized', 'completed'] },
    });
    if (!payment) return;

    if (payment.status !== 'completed' && payment.stripePaymentIntentId) {
      const stripe = this.getStripeClient();
      const intent = await stripe.paymentIntents.retrieve(
        payment.stripePaymentIntentId,
      );

      if (intent.status === 'requires_capture') {
        payment.status = 'authorized';
        consultation.paymentStatus = PaymentStatus.AUTHORIZED;
        await payment.save();
        await consultation.save();
        return;
      }

      if (intent.status !== 'succeeded') return;

      payment.status = 'completed';
      await payment.save();
    }

    if (payment.status === 'completed') {
      consultation.paymentStatus = PaymentStatus.PAID;
      if (consultation.adminStatus !== 'approved') {
        consultation.status = ConsultationStatus.PENDING;
      }
      await consultation.save();
    }
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
    if (!Types.ObjectId.isValid(id)) {
      throw new HttpException(
        'Invalid Consultation ID',
        HttpStatus.BAD_REQUEST,
      );
    }

    const consultation = await this.consultationModel.findById(id);
    if (!consultation) {
      throw new HttpException('Consultation not found', HttpStatus.NOT_FOUND);
    }

    // Auto-sync status from Stripe if payment is completed but local DB is still pending
    if (
      consultation.fee > 0 &&
      consultation.paymentStatus !== PaymentStatus.PAID
    ) {
      if (this.stripe) {
        try {
          await this.syncStripePayment(consultation);
        } catch (err) {
          // Ignore Stripe retrieval errors to avoid breaking the GET request
        }
      }
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
    if (consultation.fee > 0) {
      await this.syncStripePayment(consultation);
    }
    if (
      consultation.fee > 0 &&
      consultation.paymentStatus === PaymentStatus.AUTHORIZED
    ) {
      const payment = await this.paymentModel.findOne({
        consultation: consultation._id,
        status: 'authorized',
      });
      if (!payment?.stripePaymentIntentId) {
        throw new HttpException(
          'Cannot approve: authorized payment record not found',
          HttpStatus.CONFLICT,
        );
      }

      try {
        const stripe = this.getStripeClient();
        const intent = await stripe.paymentIntents.capture(
          payment.stripePaymentIntentId,
        );
        if (intent.status !== 'succeeded') {
          throw new Error(`Stripe capture status is ${intent.status}`);
        }

        payment.status = 'completed';
        await payment.save();
        consultation.paymentStatus = PaymentStatus.PAID;
      } catch (err: any) {
        throw new HttpException(
          `Payment capture failed: ${err.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
    if (
      consultation.fee > 0 &&
      consultation.paymentStatus !== PaymentStatus.PAID
    ) {
      throw new HttpException(
        'Cannot approve: payment is not authorized yet',
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
    if (consultation.fee > 0) {
      await this.syncStripePayment(consultation);
    }
    if (
      consultation.fee > 0 &&
      consultation.paymentStatus === PaymentStatus.PAID
    ) {
      const payment = await this.paymentModel.findOne({
        consultation: consultation._id,
        status: 'completed',
      });

      if (!payment?.stripePaymentIntentId) {
        throw new HttpException(
          'Cannot reject: completed payment record not found',
          HttpStatus.CONFLICT,
        );
      }

      try {
        const stripe = this.getStripeClient();

        await stripe.refunds.create({
          payment_intent: payment.stripePaymentIntentId,
        });

        payment.status = 'refunded';
        await payment.save();

        consultation.paymentStatus = PaymentStatus.REFUNDED;
      } catch (err: any) {
        throw new HttpException(
          `Refund failed: ${err.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    if (
      consultation.fee > 0 &&
      consultation.paymentStatus !== PaymentStatus.PAID
    ) {
      const payment = await this.paymentModel.findOne({
        consultation: consultation._id,
        status: { $in: ['pending', 'authorized'] },
      });

      if (payment?.stripePaymentIntentId) {
        try {
          const stripe = this.getStripeClient();
          await stripe.paymentIntents.cancel(payment.stripePaymentIntentId);
          payment.status = 'cancelled';
          await payment.save();
          consultation.paymentStatus = PaymentStatus.CANCELLED;
        } catch (err: any) {
          throw new HttpException(
            `Payment cancellation failed: ${err.message}`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }

        consultation.paymentStatus = PaymentStatus.CANCELLED;
      }
    }

    consultation.status = ConsultationStatus.CANCELLED;
    consultation.adminStatus = 'rejected';
    await consultation.save();

    return consultation;
  }
}
