/**
 * Unified Chat Message Model & Filtering (Demo Mode)
 */
export class ChatManager {
  constructor() {
    this.messages = [
      {
        id: 'm1',
        platform: 'youtube',
        username: 'GamerZone',
        message: 'Mic audio is crystal clear bro!',
        timestamp: Date.now() - 120000
      },
      {
        id: 'm2',
        platform: 'kick',
        username: 'ShadowNinja',
        message: 'Payuu Studio looks clean 👌',
        timestamp: Date.now() - 60000
      },
      {
        id: 'm3',
        platform: 'twitch',
        username: 'AlexR',
        message: 'Let\'s gooo! Win this game!',
        timestamp: Date.now() - 30000
      },
      {
        id: 'm4',
        platform: 'superchat',
        username: 'Rahul V.',
        message: '₹100 — Amazing stream! Keep it up!',
        timestamp: Date.now() - 15000
      }
    ];

    this.filter = 'all';
    this.onMessageAdded = null;
  }

  getFilteredMessages() {
    if (this.filter === 'all') return this.messages;
    return this.messages.filter((m) => m.platform === this.filter);
  }

  setFilter(platform) {
    this.filter = platform;
  }

  addMessage(messageObj) {
    this.messages.push({
      id: 'm_' + Date.now(),
      ...messageObj,
      timestamp: Date.now()
    });

    if (this.onMessageAdded) {
      this.onMessageAdded(this.getFilteredMessages());
    }
  }
}