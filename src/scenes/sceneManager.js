/**
 * Scene Manager: Manages scene definitions, active scene state, and per-scene source configurations.
 */
export class SceneManager {
  constructor() {
    this.scenes = [
      {
        id: 'main-gameplay',
        name: 'Main Gameplay',
        icon: 'fa-gamepad',
        sources: {
          showScreen: true,
          showCamera: true,
          showText: false,
          showOverlay: true
        }
      },
      {
        id: 'just-chatting',
        name: 'Just Chatting',
        icon: 'fa-mug-hot',
        sources: {
          showScreen: false,
          showCamera: true,
          showText: false,
          showOverlay: true
        }
      },
      {
        id: 'starting-soon',
        name: 'Starting Soon',
        icon: 'fa-clock',
        sources: {
          showScreen: false,
          showCamera: false,
          showText: true,
          textMessage: 'STREAM STARTING SOON',
          showOverlay: false
        }
      },
      {
        id: 'brb',
        name: 'Be Right Back',
        icon: 'fa-pause',
        sources: {
          showScreen: false,
          showCamera: false,
          showText: true,
          textMessage: 'BE RIGHT BACK',
          showOverlay: false
        }
      },
      {
        id: 'ending',
        name: 'Ending Stream',
        icon: 'fa-flag-checkered',
        sources: {
          showScreen: false,
          showCamera: false,
          showText: true,
          textMessage: 'THANKS FOR WATCHING!',
          showOverlay: false
        }
      }
    ];

    this.activeSceneId = 'main-gameplay';
    this.onSceneChange = null;
  }

  getActiveScene() {
    return this.scenes.find((s) => s.id === this.activeSceneId) || this.scenes[0];
  }

  setActiveScene(sceneId) {
    const target = this.scenes.find((s) => s.id === sceneId);
    if (!target) return;
    this.activeSceneId = sceneId;
    if (this.onSceneChange) {
      this.onSceneChange(target);
    }
  }
}