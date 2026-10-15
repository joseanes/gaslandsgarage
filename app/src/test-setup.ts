// Import any global setup functions for tests
import '@testing-library/svelte';
import { vi } from 'vitest';

// Mock any browser-only globals that might be needed
if (typeof window !== 'undefined') {
  // Add any window mock properties here
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Mock localStorage and sessionStorage
class LocalStorageMock {
  private store: Record<string, string> = {};

  clear() {
    this.store = {};
  }

  getItem(key: string) {
    return this.store[key] || null;
  }

  setItem(key: string, value: string) {
    this.store[key] = String(value);
  }

  removeItem(key: string) {
    delete this.store[key];
  }
}

global.localStorage = new LocalStorageMock() as unknown as Storage;
global.sessionStorage = new LocalStorageMock() as unknown as Storage;

// Mock any other browser APIs as needed
global.fetch = vi.fn();
global.console = {
  ...console,
  // Make console less noisy during tests
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
};

// Add any other global setup needed