import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export type TeachingSettingsData = {
  sessionDurationMinutes: number;
  defaultFee: number;
  timezone: string;
  workHoursStart: string;
  workHoursEnd: string;
  remindStudents: boolean;
  allowOnlineBooking: boolean;
  autoInvoiceMonthly: boolean;
  breakBetweenSessions: boolean;
};

export type PaymentSettingsData = {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  branch: string;
  autoPaymentReminder: boolean;
  electronicReceipt: boolean;
};

@Injectable()
export class TutorSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTutor({ tutorId }: { tutorId: string }) {
    return this.prisma.tutorSetting.findUnique({ where: { tutorId } });
  }

  async upsert({ tutorId, data }: { tutorId: string; data: TeachingSettingsData }) {
    return this.prisma.tutorSetting.upsert({
      where: { tutorId },
      create: { tutorId, ...data },
      update: data,
    });
  }

  async findPaymentByTutor({ tutorId }: { tutorId: string }) {
    return this.prisma.tutorPaymentSetting.findUnique({ where: { tutorId } });
  }

  async upsertPayment({ tutorId, data }: { tutorId: string; data: PaymentSettingsData }) {
    return this.prisma.tutorPaymentSetting.upsert({
      where: { tutorId },
      create: { tutorId, ...data },
      update: data,
    });
  }
}
