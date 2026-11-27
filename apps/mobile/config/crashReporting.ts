import { unconfiguredTransport, type CrashTransport } from '../services/crashReporting';

/** No crash-reporting service is configured in this build; diagnostics never leave the device. */
export const crashTransport: CrashTransport = unconfiguredTransport;
