import { createConsumer } from '@rails/actioncable';

let consumer: ReturnType<typeof createConsumer> | null = null;

export function getCableConsumer() {
  if (!consumer) {
    consumer = createConsumer(); // connects to /cable, cookies sent automatically
  }
  return consumer;
}

export function disconnectCable() {
  consumer?.disconnect();
  consumer = null;
}
