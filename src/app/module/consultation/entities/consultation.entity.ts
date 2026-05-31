// consultation.entity.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ConsultationDocument = HydratedDocument<Consultation>;

export enum ConsultationStatus {
  PENDING = 'Pending',
  CONFIRMED = 'Confirmed',
  MEETING_SCHEDULED = 'Meeting Scheduled',
  COMPLETED = 'Completed',
  CANCELLED = 'Cancelled',
  RESCHEDULED = 'Rescheduled',
}

export enum ConsultationType {
  VISA = 'Visa Consultation',
  STUDY_ABROAD = 'Study Abroad',
  TOUR = 'Tour Package',
  GENERAL = 'General',
}

export enum PaymentStatus {
  FREE = 'Free',
  PAID = 'Paid',
}

export enum Duration {
  THIRTY_MIN = '30 Minutes',
  ONE_HOUR = '1 Hour',
}

@Schema({ timestamps: true })
export class Consultation {
  @Prop({ required: true })
  clientName: string;

  @Prop({ required: true })
  email: string;

  @Prop()
  phone: string;

  @Prop({ enum: ConsultationType, required: true })
  type: ConsultationType;

  @Prop({ enum: Duration })
  duration: Duration;

  @Prop({ default: 0 })
  fee: number;

  @Prop({ required: true })
  preferredDate: Date;

  @Prop({ required: true })
  preferredTime: string;

  @Prop()
  message: string;

  @Prop({ enum: ConsultationStatus, default: ConsultationStatus.PENDING })
  status: ConsultationStatus;

  @Prop({ enum: PaymentStatus, default: PaymentStatus.FREE })
  paymentStatus: PaymentStatus;

  @Prop()
  meetingLink: string;

  @Prop()
  adminNotes: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({enum:['Pending','approved','rejected'],default:'Pending'})
  adminStatus:string;
}

export const ConsultationSchema = SchemaFactory.createForClass(Consultation);
