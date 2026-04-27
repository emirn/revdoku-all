/// <reference types="vite/client" />

declare module '@rails/actioncable' {
  export interface Subscription {
    unsubscribe(): void;
    perform(action: string, data?: Record<string, unknown>): void;
    send(data: unknown): boolean;
  }

  export interface SubscriptionCallbacks {
    received?(data: unknown): void;
    initialized?(): void;
    connected?(): void;
    disconnected?(): void;
    rejected?(): void;
  }

  export interface Subscriptions {
    create(channelName: string | object, callbacks?: SubscriptionCallbacks): Subscription;
  }

  export interface Consumer {
    subscriptions: Subscriptions;
    disconnect(): void;
  }

  export function createConsumer(url?: string): Consumer;
}
