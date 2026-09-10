import type { AnnouncementRecipientsGateway } from './announcementRecipients.repository.js';

export class InMemoryAnnouncementRecipientsGateway implements AnnouncementRecipientsGateway {
  constructor(private readonly recipientsByClubAndGroup: Map<string, string[]> = new Map()) {}

  async findRecipientUserIds(clubId: string, groupId: string | null, excludeUserId: string): Promise<string[]> {
    const ids = this.recipientsByClubAndGroup.get(`${clubId}:${groupId ?? ''}`) ?? [];
    return ids.filter((id) => id !== excludeUserId);
  }
}
