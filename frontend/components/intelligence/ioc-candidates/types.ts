export type IocCandidate = {
  readonly id: string;
  readonly type: 'IPV4' | 'IPV6' | 'DOMAIN' | 'URL' | 'MD5' | 'SHA1' | 'SHA256';
  readonly rawValue: string;
  readonly normalizedValue: string;
  readonly confidence: number;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly createdAt: string;
  readonly intelligenceSource: { readonly id: string; readonly name: string };
  readonly observations: readonly {
    readonly id: string;
    readonly telegramStagingMessage: {
      readonly messageId: string;
      readonly channelTitle: string;
      readonly channelUsername: string | null;
      readonly messageUrl: string | null;
      readonly messageTimestamp: string;
    };
  }[];
};

export type CandidateReviewResult =
  | { readonly status: 'APPROVED'; readonly candidateId: string; readonly indicatorId: string; readonly indicatorCreated: boolean }
  | { readonly status: 'REJECTED'; readonly candidateId: string };
