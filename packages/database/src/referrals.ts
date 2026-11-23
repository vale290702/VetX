export interface ReferralClinic {
  organizationId: string;
  clinicId: string;
}

export interface ReferralRequestInput {
  guardianId: string;
  destination: ReferralClinic;
  reason: string;
  summary: string;
}

export interface ReferralDecision {
  action: "approve" | "decline" | "withdraw";
  revision: number;
}

export interface ReferralResponseInput {
  summary: string;
  revision: number;
}

export type ReferralStatus = "REQUESTED" | "APPROVED" | "DECLINED" | "WITHDRAWN" | "RESPONDED";
interface ReferralAuthor {
  issuer: string;
  subject: string;
}
export interface Referral {
  id: string;
  status: ReferralStatus;
  revision: number;
  source: ReferralClinic & { organizationName: string; clinicName: string };
  destination: ReferralClinic & { organizationName: string; clinicName: string };
  patient: { id: string; name: string; species: string };
  reason: string;
  summary: string;
  requestedAt: string;
  requestedBy: ReferralAuthor;
  response: { summary: string; recordedAt: string; author: ReferralAuthor } | null;
}

export interface StaffReferralFilter {
  direction: "incoming" | "outgoing";
  page: number;
  patientId?: string;
}

export interface ReferralPage {
  referrals: Referral[];
  page: number;
  hasNextPage: boolean;
}

export type ReferralErrorCode = "invalid" | "forbidden" | "not_found" | "conflict";
export class ReferralError extends Error {
  constructor(readonly code: ReferralErrorCode) {
    super(code);
    this.name = "ReferralError";
  }
}
