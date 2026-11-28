import { ForbiddenException } from '@nestjs/common';
import { TutorSettingsService } from 'src/features/tutor-settings/tutor-settings.service';

// regression (TS-19): payment/teaching updates only for TUTOR/ADMIN, fail closed.
describe('TutorSettingsService role check (TS-19)', () => {
  const repo = { upsert: jest.fn(), upsertPayment: jest.fn() };
  const service = new TutorSettingsService(repo as never);
  const payment = {
    bankName: 'B',
    accountHolder: 'H',
    accountNumber: '1 2 3',
    branch: '',
    autoPaymentReminder: true,
    electronicReceipt: false,
  };
  const teaching = {
    sessionDurationMinutes: 60,
    defaultFee: 1,
    timezone: 'hanoi',
    workHoursStart: '08:00',
    workHoursEnd: '21:00',
    remindStudents: true,
    allowOnlineBooking: true,
    autoInvoiceMonthly: false,
    breakBetweenSessions: false,
  };
  const callPayment = (role: unknown) =>
    (service.updatePaymentSettingsService as (p: unknown) => Promise<unknown>)({
      userId: 'u',
      role,
      data: payment,
    });
  const callTeaching = (role: unknown) =>
    (service.updateTeachingSettingsService as (p: unknown) => Promise<unknown>)({
      userId: 'u',
      role,
      data: teaching,
    });

  beforeEach(() => jest.clearAllMocks());

  it.each(['STUDENT', 'PARENT', undefined, ''])('rejects payment update for %p', async (role) => {
    await expect(callPayment(role)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.upsertPayment).not.toHaveBeenCalled();
  });

  it.each(['STUDENT', 'PARENT', undefined, ''])('rejects teaching update for %p', async (role) => {
    await expect(callTeaching(role)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it.each(['TUTOR', 'ADMIN'])('allows both updates for %s', async (role) => {
    await callPayment(role);
    await callTeaching(role);
    expect(repo.upsertPayment).toHaveBeenCalledTimes(1);
    expect(repo.upsert).toHaveBeenCalledTimes(1);
  });
});
