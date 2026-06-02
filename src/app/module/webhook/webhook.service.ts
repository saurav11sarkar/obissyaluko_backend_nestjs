import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import config from 'src/app/config';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from '../user/entities/user.entity';
import { Model } from 'mongoose';
import { Payment, PaymentDocument } from '../payment/entities/payment.entity';
import {
  Subscribe,
  SubscribeDocument,
} from '../subscribe/entities/subscribe.entity';
import type { Response } from 'express';
import {
  Consultation,
  ConsultationDocument,
  ConsultationStatus,
  PaymentStatus,
} from '../consultation/entities/consultation.entity';

@Injectable()
export class WebhookService {
  private readonly stripe?: Stripe;
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,

    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,

    @InjectModel(Subscribe.name)
    private readonly subscribeModel: Model<SubscribeDocument>,

    @InjectModel(Consultation.name)
    private readonly consultationModel: Model<ConsultationDocument>,
  ) {
    if (config.stripe.secretKey) {
      this.stripe = new Stripe(config.stripe.secretKey);
    }
  }

  async handleWebhook(rawBody: Buffer, sig: string, res: Response) {
    if (!this.stripe || !config.stripe.webhookSecret) {
      return res
        .status(500)
        .json({ message: 'Stripe webhook is not configured' });
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        sig,
        config.stripe.webhookSecret,
      );
    } catch (err: any) {
      this.logger.error(`Webhook signature error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event, res);
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event, res);
          break;

        case 'payment_intent.amount_capturable_updated':
          await this.handlePaymentIntentAuthorized(event, res);
          break;

        case 'payment_intent.canceled':
          await this.handlePaymentIntentCanceled(event, res);
          break;

        case 'charge.refunded':
          await this.handleChargeRefunded(event, res);
          break;

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
          return res.json({ received: true });
      }
    } catch (err: any) {
      this.logger.error(`Handler error: ${err.message}`);
      return res.status(500).send(`Webhook Handler Error: ${err.message}`);
    }
  }

  private async handlePaymentIntentSucceeded(
    event: Stripe.Event,
    res: Response,
  ) {
    const intent = event.data.object as Stripe.PaymentIntent;
    const paymentType = intent.metadata?.paymentType;

    const payment = await this.paymentModel.findOne({
      stripePaymentIntentId: intent.id,
    });
    if (!payment) return res.json({ received: true });

    if (payment.status === 'completed' || payment.status === 'refunded') {
      return res.json({ received: true, ignored: 'already_processed' });
    }

    payment.status = 'completed';
    await payment.save();

    if (paymentType === 'subscription') {
      const subscribeId =
        payment.subscribe?.toString() ?? intent.metadata?.subscribeId;
      if (!subscribeId) return res.json({ received: true });

      const plan = await this.subscribeModel.findById(subscribeId);
      if (!plan) return res.json({ received: true });

      const alreadyAdded = plan.user?.some(
        (id) => id.toString() === payment.user.toString(),
      );
      if (!alreadyAdded) {
        plan.user = plan.user ?? [];
        plan.user.push(payment.user);
        await plan.save();
      }

      return res.json({ received: true, type: 'subscription' });
    }

    if (paymentType === 'consultation') {
      const consultationId =
        payment.consultation?.toString() ?? intent.metadata?.consultationId;
      if (!consultationId) return res.json({ received: true });

      const consultation =
        await this.consultationModel.findById(consultationId);
      if (!consultation) return res.json({ received: true });

      consultation.paymentStatus = PaymentStatus.PAID;
      if (consultation.adminStatus !== 'approved') {
        consultation.status = ConsultationStatus.PENDING;
      }
      await consultation.save();

      this.logger.log(
        `Consultation ${consultationId} payment received. Awaiting admin approval.`,
      );

      return res.json({
        received: true,
        type: 'consultation',
        status: 'awaiting_admin_approval',
      });
    }

    return res.json({ received: true });
  }

  // ── payment_intent.payment_failed ──────────────────────────────────────────
  private async handlePaymentIntentFailed(event: Stripe.Event, res: Response) {
    const intent = event.data.object as Stripe.PaymentIntent;

    const payment = await this.paymentModel.findOne({
      stripePaymentIntentId: intent.id,
    });
    if (payment) {
      payment.status = 'failed';
      await payment.save();
    }

    return res.json({ received: true });
  }

  private async handlePaymentIntentAuthorized(
    event: Stripe.Event,
    res: Response,
  ) {
    const intent = event.data.object as Stripe.PaymentIntent;
    if (intent.metadata?.paymentType !== 'consultation') {
      return res.json({ received: true });
    }

    const payment = await this.paymentModel.findOne({
      stripePaymentIntentId: intent.id,
    });
    if (!payment) return res.json({ received: true });

    payment.status = 'authorized';
    await payment.save();

    if (payment.consultation) {
      const consultation = await this.consultationModel.findById(
        payment.consultation,
      );
      if (consultation?.adminStatus === 'rejected') {
        await this.stripe?.paymentIntents.cancel(intent.id);
        payment.status = 'cancelled';
        await payment.save();
        consultation.paymentStatus = PaymentStatus.CANCELLED;
        await consultation.save();
        return res.json({ received: true, ignored: 'consultation_rejected' });
      }

      if (consultation) {
        consultation.paymentStatus = PaymentStatus.AUTHORIZED;
        await consultation.save();
      }
    }

    return res.json({ received: true, type: 'consultation_authorized' });
  }

  private async handlePaymentIntentCanceled(
    event: Stripe.Event,
    res: Response,
  ) {
    const intent = event.data.object as Stripe.PaymentIntent;
    const payment = await this.paymentModel.findOne({
      stripePaymentIntentId: intent.id,
    });
    if (!payment) return res.json({ received: true });

    payment.status = 'cancelled';
    await payment.save();

    if (payment.consultation) {
      await this.consultationModel.findByIdAndUpdate(payment.consultation, {
        $set: { paymentStatus: PaymentStatus.CANCELLED },
      });
    }

    return res.json({ received: true, type: 'payment_cancelled' });
  }

  private async handleChargeRefunded(event: Stripe.Event, res: Response) {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;
    if (!paymentIntentId) return res.json({ received: true });

    const payment = await this.paymentModel.findOne({
      stripePaymentIntentId: paymentIntentId,
    });
    if (!payment) return res.json({ received: true });

    payment.status = 'refunded';
    await payment.save();

    if (payment.consultation) {
      await this.consultationModel.findByIdAndUpdate(payment.consultation, {
        $set: { paymentStatus: PaymentStatus.REFUNDED },
      });
    }

    return res.json({ received: true, type: 'refund' });
  }
}
