import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PaymentSettingsData, TeachingSettingsData } from './tutor-settings.repository';
import { TutorSettingsService } from './tutor-settings.service';

/** Message-pattern handlers reached through the gateway's TUTOR_SERVICE client. */
@Controller()
export class TutorSettingsRpcController {
  constructor(private readonly service: TutorSettingsService) {}

  @MessagePattern('settings.teachingGet')
  get(@Payload() payload: { userId: string }) {
    return this.service.getTeachingSettingsService(payload);
  }

  @MessagePattern('settings.teachingUpdate')
  update(@Payload() payload: { userId: string; data: TeachingSettingsData }) {
    return this.service.updateTeachingSettingsService(payload);
  }

  @MessagePattern('settings.paymentGet')
  getPayment(@Payload() payload: { userId: string }) {
    return this.service.getPaymentSettingsService(payload);
  }

  @MessagePattern('settings.paymentUpdate')
  updatePayment(@Payload() payload: { userId: string; data: PaymentSettingsData }) {
    return this.service.updatePaymentSettingsService(payload);
  }
}
