/**
 * SuperChat Event Model & Queue Management (Demo Simulation)
 */
export class SuperChatManager {
  constructor() {
    this.activeAlert = null;
    this.alertTimer = null;
    this.onAlertChange = null;

    this.mockEvents = [
      {
        id: 'sc_1',
        supporterName: 'Rahul V.',
        amount: 100,
        currency: '₹',
        message: 'Amazing stream! Keep it up! 🔥',
        timestamp: Date.now()
      },
      {
        id: 'sc_2',
        supporterName: 'Pooja Sharma',
        amount: 500,
        currency: '₹',
        message: 'Free Fire custom room OP gameplay!',
        timestamp: Date.now() - 1000 * 60
      }
    ];
  }

  getLatestEvent() {
    return this.mockEvents[0];
  }

  triggerAlert(event, durationMs = 5000) {
    if (this.alertTimer) {
      clearTimeout(this.alertTimer);
    }

    this.activeAlert = {
      ...event,
      expiresAt: Date.now() + durationMs
    };

    if (this.onAlertChange) this.onAlertChange(this.activeAlert);

    this.alertTimer = setTimeout(() => {
      this.activeAlert = null;
      if (this.onAlertChange) this.onAlertChange(null);
    }, durationMs);
  }
}