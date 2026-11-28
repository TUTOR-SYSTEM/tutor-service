import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  PaymentSettingsData,
  TeachingSettingsData,
  TutorSettingsRepository,
} from './tutor-settings.repository';

/** Roles allowed to change payment/teaching settings (TS-19). Exact match; fail closed. */
const SETTINGS_WRITE_ROLES: ReadonlySet<string> = new Set(['TUTOR', 'ADMIN']);

function assertSettingsWriter(role: string | undefined): void {
  if (role === undefined || !SETTINGS_WRITE_ROLES.has(role)) {
    throw new ForbiddenException('FORBIDDEN_ROLE');
  }
}

/** Mặc định khi gia sư chưa khai báo tài khoản nhận tiền. */
export const DEFAULT_PAYMENT_SETTINGS: PaymentSettingsData = {
  bankName: '',
  accountHolder: '',
  accountNumber: '',
  branch: '',
  autoPaymentReminder: true,
  electronicReceipt: false,
};

/** Giá trị mặc định khi gia sư chưa lưu cài đặt (khớp default của bảng tutor_settings). */
export const DEFAULT_TEACHING_SETTINGS: TeachingSettingsData = {
  sessionDurationMinutes: 90,
  defaultFee: 250000,
  timezone: 'hanoi',
  workHoursStart: '08:00',
  workHoursEnd: '21:00',
  remindStudents: true,
  allowOnlineBooking: true,
  autoInvoiceMonthly: false,
  breakBetweenSessions: false,
};

@Injectable()
export class TutorSettingsService {
  constructor(private readonly repo: TutorSettingsRepository) {}

  async getTeachingSettingsService({ userId }: { userId: string }): Promise<TeachingSettingsData> {
    const row = await this.repo.findByTutor({ tutorId: userId });
    if (!row) return DEFAULT_TEACHING_SETTINGS;
    return {
      sessionDurationMinutes: row.sessionDurationMinutes,
      defaultFee: Number(row.defaultFee),
      timezone: row.timezone,
      workHoursStart: row.workHoursStart,
      workHoursEnd: row.workHoursEnd,
      remindStudents: row.remindStudents,
      allowOnlineBooking: row.allowOnlineBooking,
      autoInvoiceMonthly: row.autoInvoiceMonthly,
      breakBetweenSessions: row.breakBetweenSessions,
    };
  }

  async updateTeachingSettingsService({
    userId,
    role,
    data,
  }: {
    userId: string;
    role?: string;
    data: TeachingSettingsData;
  }): Promise<TeachingSettingsData> {
    assertSettingsWriter(role);
    await this.repo.upsert({ tutorId: userId, data });
    return data;
  }

  async getPaymentSettingsService({ userId }: { userId: string }): Promise<PaymentSettingsData> {
    const row = await this.repo.findPaymentByTutor({ tutorId: userId });
    if (!row) return DEFAULT_PAYMENT_SETTINGS;
    return {
      bankName: row.bankName,
      accountHolder: row.accountHolder,
      accountNumber: row.accountNumber,
      branch: row.branch,
      autoPaymentReminder: row.autoPaymentReminder,
      electronicReceipt: row.electronicReceipt,
    };
  }

  async updatePaymentSettingsService({
    userId,
    role,
    data,
  }: {
    userId: string;
    role?: string;
    data: PaymentSettingsData;
  }): Promise<PaymentSettingsData> {
    assertSettingsWriter(role);
    // số tài khoản lưu dạng liền, không khoảng trắng
    const normalized = { ...data, accountNumber: data.accountNumber.replace(/\s/g, '') };
    await this.repo.upsertPayment({ tutorId: userId, data: normalized });
    return normalized;
  }
}
