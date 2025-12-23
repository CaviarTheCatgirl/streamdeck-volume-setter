import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  DidReceiveSettingsEvent
} from '@elgato/streamdeck';
import { spawn } from 'child_process';
import { join } from 'path';
import { copyFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Global state manager for profile synchronization
interface VolumeProfile {
  deviceName: string;
  volume1Left: number;
  volume1Right: number;
  volume2Left: number;
  volume2Right: number;
  currentState: number; // 0 or 1
  isConfigured: boolean; // Track if profile has been configured
  image1Path?: string; // Image path for State 1
  image2Path?: string; // Image path for State 2
}

interface ActionSettings {
  profileId?: string;
  deviceName?: string;
  volume1Left?: number;
  volume1Right?: number;
  volume2Left?: number;
  volume2Right?: number;
  showText1?: boolean;
  showText2?: boolean;
  image1Path?: string; // File path for State 1 image
  image2Path?: string; // File path for State 2 image
  [key: string]: string | number | boolean | undefined;
}

// Persistent storage key for profiles
const PROFILES_STORAGE_KEY = 'volume_profiles';

const globalProfiles = new Map<string, VolumeProfile>();
const profileContexts = new Map<string, Set<string>>();
const actionSettings = new Map<string, ActionSettings>(); // Track all button settings
let profilesLoaded = false; // Track if we've loaded from storage

// Get the plugin's data directory
const getPluginDataPath = () => {
  const appData = process.env.APPDATA || process.env.HOME || '';
  return join(appData, 'Elgato', 'StreamDeck', 'Plugins', 'com.caviarthecatgirl.volume-setter.sdPlugin', 'images');
};

// Ensure data directory exists
const ensureDataDirectory = () => {
  const dataPath = getPluginDataPath();
  if (!existsSync(dataPath)) {
    mkdirSync(dataPath, { recursive: true });
  }
  return dataPath;
};

@action({ UUID: 'com.caviarthecatgirl.volume-setter.toggle' })
export class VolumeToggleAction extends SingletonAction<ActionSettings> {

  constructor() {
    super();
    // Ensure data directory exists on plugin load
    ensureDataDirectory();
  }

  // Copy image to plugin data folder and return new path
  private copyImageToDataFolder(sourcePath: string): string {
    try {
      const dataPath = ensureDataDirectory();
      const ext = sourcePath.substring(sourcePath.lastIndexOf('.'));
      const newFileName = `${uuidv4()}${ext}`;
      const destPath = join(dataPath, newFileName);
      
      copyFileSync(sourcePath, destPath);
      streamDeck.logger.info(`Copied image from ${sourcePath} to ${destPath}`);
      
      return destPath;
    } catch (error) {
      streamDeck.logger.error(`Failed to copy image: ${error}`);
      throw error;
    }
  }

  // Delete image from plugin data folder
  private deleteImageFromDataFolder(imagePath: string): void {
    try {
      if (existsSync(imagePath)) {
        unlinkSync(imagePath);
        streamDeck.logger.info(`Deleted image: ${imagePath}`);
      }
    } catch (error) {
      streamDeck.logger.error(`Failed to delete image: ${error}`);
    }
  }

  // Load profiles from persistent storage
  private async loadProfilesFromStorage(): Promise<void> {
    if (profilesLoaded) return; // Already loaded
    
    try {
      const stored = await streamDeck.settings.getGlobalSettings();
      const profilesData = stored[PROFILES_STORAGE_KEY];
      
      if (profilesData && typeof profilesData === 'string') {
        const profiles = JSON.parse(profilesData) as Record<string, VolumeProfile>;
        
        for (const [profileId, profile] of Object.entries(profiles)) {
          globalProfiles.set(profileId, profile);
        }
        
        streamDeck.logger.info(`Loaded ${Object.keys(profiles).length} profiles from storage`);
      } else {
        streamDeck.logger.info('No profiles found in storage');
      }
    } catch (error) {
      streamDeck.logger.error('Failed to load profiles from storage:', error);
    }
    
    profilesLoaded = true;
  }

  // Save profiles to persistent storage
  private async saveProfilesToStorage(): Promise<void> {
    try {
      const profilesObj: Record<string, VolumeProfile> = {};
      
      for (const [profileId, profile] of globalProfiles.entries()) {
        if (profile.isConfigured) {
          profilesObj[profileId] = profile;
        }
      }
      
      await streamDeck.settings.setGlobalSettings({
        [PROFILES_STORAGE_KEY]: JSON.stringify(profilesObj)
      });
      
      streamDeck.logger.info(`Saved ${Object.keys(profilesObj).length} profiles to storage`);
    } catch (error) {
      streamDeck.logger.error('Failed to save profiles to storage:', error);
    }
  }

  override async onWillAppear(ev: WillAppearEvent<ActionSettings>): Promise<void> {
    // Load profiles from storage on first button appearance
    await this.loadProfilesFromStorage();
    
    const settings = ev.payload.settings;
    const profileId = settings.profileId || ev.action.id;

    // Store this button's settings for potential future lookups
    actionSettings.set(ev.action.id, settings);

    // Register this context to the profile FIRST
    if (!profileContexts.has(profileId)) {
      profileContexts.set(profileId, new Set());
    }
    profileContexts.get(profileId)!.add(ev.action.id);

    const existingProfile = globalProfiles.get(profileId);
    const buttonIsConfigured = this.isSettingsConfigured(settings);

    if (existingProfile) {
      // Profile exists
      if (existingProfile.isConfigured) {
        // Existing profile is configured - sync FROM it
        streamDeck.logger.info(`Button ${ev.action.id} joining configured profile "${profileId}"`);
        
        const syncedSettings: ActionSettings = {
          profileId: settings.profileId, // Keep the profileId as-is
          deviceName: existingProfile.deviceName,
          volume1Left: existingProfile.volume1Left,
          volume1Right: existingProfile.volume1Right,
          volume2Left: existingProfile.volume2Left,
          volume2Right: existingProfile.volume2Right,
          // Get image paths from the profile itself
          image1Path: existingProfile.image1Path,
          image2Path: existingProfile.image2Path,
          showText1: await this.getProfileShowText(profileId, 'showText1'),
          showText2: await this.getProfileShowText(profileId, 'showText2')
        };
        
        streamDeck.logger.info(`Syncing images - image1Path: ${syncedSettings.image1Path}, image2Path: ${syncedSettings.image2Path}`);
        
        // Update this button's stored settings
        actionSettings.set(ev.action.id, syncedSettings);
        
        await ev.action.setSettings(syncedSettings);
        
        // Send to Property Inspector if it's a KeyAction
        if ('sendToPropertyInspector' in ev.action && typeof ev.action.sendToPropertyInspector === 'function') {
          await (ev.action as any).sendToPropertyInspector({
            event: 'settingsSynced',
            settings: syncedSettings
          });
        }
        
        // IMPORTANT: Also sync the current toggle state immediately
        await this.updateButtonState(ev.action.id, profileId);
      } else if (buttonIsConfigured) {
        // Profile exists but unconfigured, this button IS configured - update profile
        streamDeck.logger.info(`Button ${ev.action.id} configuring profile "${profileId}"`);
        
        existingProfile.deviceName = settings.deviceName!;
        existingProfile.volume1Left = settings.volume1Left!;
        existingProfile.volume1Right = settings.volume1Right!;
        existingProfile.volume2Left = settings.volume2Left!;
        existingProfile.volume2Right = settings.volume2Right!;
        existingProfile.isConfigured = true;
        
        // Sync to all other buttons
        await this.syncProfileSettingsToAllButtons(profileId);
        
        // Update this button's state
        await this.updateButtonState(ev.action.id, profileId);
      } else {
        // Both unconfigured - show placeholder
        await this.updateButtonState(ev.action.id, profileId);
      }
    } else {
      // New profile
      if (buttonIsConfigured) {
        // Create configured profile
        streamDeck.logger.info(`Button ${ev.action.id} creating configured profile "${profileId}"`);
        
        globalProfiles.set(profileId, {
          deviceName: settings.deviceName!,
          volume1Left: settings.volume1Left!,
          volume1Right: settings.volume1Right!,
          volume2Left: settings.volume2Left!,
          volume2Right: settings.volume2Right!,
          currentState: 0,
          isConfigured: true
        });
        
        // Save to persistent storage
        await this.saveProfilesToStorage();
        
        // Update button state
        await this.updateButtonState(ev.action.id, profileId);
      } else {
        // Create unconfigured profile (placeholder)
        streamDeck.logger.info(`Button ${ev.action.id} creating unconfigured profile "${profileId}"`);
        
        globalProfiles.set(profileId, {
          deviceName: '',
          volume1Left: 0,
          volume1Right: 0,
          volume2Left: 0,
          volume2Right: 0,
          currentState: 0,
          isConfigured: false
        });
        
        // Show not configured
        await this.updateButtonState(ev.action.id, profileId);
      }
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent<ActionSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const profileId = settings.profileId || ev.action.id;

    // Remove from settings tracking
    actionSettings.delete(ev.action.id);

    const contexts = profileContexts.get(profileId);
    if (contexts) {
      contexts.delete(ev.action.id);
      if (contexts.size === 0) {
        profileContexts.delete(profileId);
        // Optionally clean up the profile too if no buttons reference it
        // globalProfiles.delete(profileId);
      }
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ActionSettings>): Promise<void> {
    let settings = ev.payload.settings;
    const oldProfileId = this.getCurrentProfileId(ev.action.id);
    const newProfileId = settings.profileId || ev.action.id;

    // Check if settings actually changed to prevent infinite loops
    const oldSettings = actionSettings.get(ev.action.id);
    if (oldSettings && this.settingsAreEqual(oldSettings, settings)) {
      streamDeck.logger.info(`Button ${ev.action.id} settings unchanged, skipping sync`);
      return;
    }

    // Update stored settings FIRST so other methods can access the new images
    actionSettings.set(ev.action.id, settings);

    streamDeck.logger.info(`Button ${ev.action.id} received settings. ProfileId: "${newProfileId}", DeviceName: "${settings.deviceName || 'none'}"`);

    // Check if this is a real configuration (all required fields present)
    const isConfigured = this.isSettingsConfigured(settings);
    
    // Handle image updates - copy new images to data folder
    
    // Check if image1Path is a new upload (not in our data folder)
    if (settings.image1Path && !settings.image1Path.includes(getPluginDataPath())) {
      const oldImage = oldSettings?.image1Path;
      try {
        settings = { ...settings, image1Path: this.copyImageToDataFolder(settings.image1Path) };
        // Delete old image if it exists and is in our data folder
        if (oldImage && oldImage.includes(getPluginDataPath())) {
          this.deleteImageFromDataFolder(oldImage);
        }
      } catch (error) {
        streamDeck.logger.error(`Failed to process image1: ${error}`);
        settings = { ...settings };
        delete settings.image1Path;
      }
    }
    
    // Check if image2Path is a new upload
    if (settings.image2Path && !settings.image2Path.includes(getPluginDataPath())) {
      const oldImage = oldSettings?.image2Path;
      try {
        settings = { ...settings, image2Path: this.copyImageToDataFolder(settings.image2Path) };
        // Delete old image if it exists and is in our data folder
        if (oldImage && oldImage.includes(getPluginDataPath())) {
          this.deleteImageFromDataFolder(oldImage);
        }
      } catch (error) {
        streamDeck.logger.error(`Failed to process image2: ${error}`);
        settings = { ...settings };
        delete settings.image2Path;
      }
    }
    
    // Handle image deletions
    if (!settings.image1Path && oldSettings?.image1Path && oldSettings.image1Path.includes(getPluginDataPath())) {
      this.deleteImageFromDataFolder(oldSettings.image1Path);
    }
    if (!settings.image2Path && oldSettings?.image2Path && oldSettings.image2Path.includes(getPluginDataPath())) {
      this.deleteImageFromDataFolder(oldSettings.image2Path);
    }
    
    // Update stored settings with processed paths
    actionSettings.set(ev.action.id, settings);

    if (!isConfigured) {
      // Incomplete settings - check if we should sync FROM an existing profile
      let existingProfile = globalProfiles.get(newProfileId);
      
      // If profile doesn't exist in memory, try to find it from other buttons
      if (!existingProfile && settings.profileId) {
        streamDeck.logger.info(`Profile "${newProfileId}" not in memory, searching other buttons...`);
        const foundProfile = await this.findAndLoadProfileFromExistingButtons(newProfileId);
        
        if (foundProfile) {
          // Load the profile into memory
          globalProfiles.set(newProfileId, foundProfile);
          existingProfile = foundProfile;
          streamDeck.logger.info(`Loaded profile "${newProfileId}" from existing button`);
        }
      }
      
      if (existingProfile && existingProfile.isConfigured && settings.profileId) {
        // There's a configured profile with this ID - sync FROM it immediately
        streamDeck.logger.info(`Button ${ev.action.id} has incomplete settings but profile "${newProfileId}" exists - syncing FROM profile`);
        
        const syncedSettings: ActionSettings = {
          profileId: settings.profileId,
          deviceName: existingProfile.deviceName,
          volume1Left: existingProfile.volume1Left,
          volume1Right: existingProfile.volume1Right,
          volume2Left: existingProfile.volume2Left,
          volume2Right: existingProfile.volume2Right,
          // Get image paths from the profile itself
          image1Path: existingProfile.image1Path,
          image2Path: existingProfile.image2Path,
          showText1: await this.getProfileShowText(newProfileId, 'showText1'),
          showText2: await this.getProfileShowText(newProfileId, 'showText2')
        };
        
        streamDeck.logger.info(`Syncing images to new button - image1Path: ${syncedSettings.image1Path}, image2Path: ${syncedSettings.image2Path}`);
        
        // Update stored settings immediately
        actionSettings.set(ev.action.id, syncedSettings);
        
        // Apply the synced settings
        await ev.action.setSettings(syncedSettings);
        
        // Ensure button is registered to this profile
        if (!profileContexts.has(newProfileId)) {
          profileContexts.set(newProfileId, new Set());
        }
        
        // Remove from old profile if it was registered elsewhere
        const oldContexts = profileContexts.get(oldProfileId);
        if (oldContexts && oldProfileId !== newProfileId) {
          oldContexts.delete(ev.action.id);
        }
        
        profileContexts.get(newProfileId)!.add(ev.action.id);
        
        streamDeck.logger.info(`Button ${ev.action.id} now registered to profile "${newProfileId}"`);
        
        // Update button state
        await this.updateButtonState(ev.action.id, newProfileId);
        
        return;
      }
      
      // Incomplete settings and no profile to sync from - just update display
      streamDeck.logger.info(`Button ${ev.action.id} has incomplete settings, waiting for user input...`);
      await this.updateButtonState(ev.action.id, newProfileId);
      return;
    }

    // Settings are complete - proceed with normal flow
    streamDeck.logger.info(`Button ${ev.action.id} has complete settings, processing...`);

    // If profileId changed, handle migration
    if (oldProfileId !== newProfileId) {
      streamDeck.logger.info(`Button ${ev.action.id} changing profile from "${oldProfileId}" to "${newProfileId}"`);
      
      // Remove from old profile
      const oldContexts = profileContexts.get(oldProfileId);
      if (oldContexts) {
        oldContexts.delete(ev.action.id);
        if (oldContexts.size === 0) {
          profileContexts.delete(oldProfileId);
        }
      }

      // Add to new profile
      if (!profileContexts.has(newProfileId)) {
        profileContexts.set(newProfileId, new Set());
      }
      profileContexts.get(newProfileId)!.add(ev.action.id);
    } else {
      // Same profile - ensure button is registered (in case it wasn't before)
      if (!profileContexts.has(newProfileId)) {
        profileContexts.set(newProfileId, new Set());
      }
      if (!profileContexts.get(newProfileId)!.has(ev.action.id)) {
        profileContexts.get(newProfileId)!.add(ev.action.id);
        streamDeck.logger.info(`Registered button ${ev.action.id} to existing profile "${newProfileId}"`);
      }
    }

    // Update or create the profile
    let profile = globalProfiles.get(newProfileId);
    
    if (!profile) {
      // Create new profile
      profile = {
        deviceName: settings.deviceName!,
        volume1Left: settings.volume1Left!,
        volume1Right: settings.volume1Right!,
        volume2Left: settings.volume2Left!,
        volume2Right: settings.volume2Right!,
        currentState: 0,
        isConfigured: true,
        image1Path: settings.image1Path,
        image2Path: settings.image2Path
      };
      globalProfiles.set(newProfileId, profile);
      streamDeck.logger.info(`Created new profile "${newProfileId}"`);
    } else {
      // Update existing profile (this button becomes the new master)
      profile.deviceName = settings.deviceName!;
      profile.volume1Left = settings.volume1Left!;
      profile.volume1Right = settings.volume1Right!;
      profile.volume2Left = settings.volume2Left!;
      profile.volume2Right = settings.volume2Right!;
      profile.isConfigured = true;
      // Update image paths - including explicit removal
      if (settings.image1Path !== undefined) {
        // If old image exists and is different, delete it
        if (profile.image1Path && profile.image1Path !== settings.image1Path && profile.image1Path.includes(getPluginDataPath())) {
          this.deleteImageFromDataFolder(profile.image1Path);
        }
        profile.image1Path = settings.image1Path;
      } else if (settings.image1Path === undefined && oldSettings?.image1Path !== undefined) {
        // Image was explicitly removed
        if (profile.image1Path && profile.image1Path.includes(getPluginDataPath())) {
          this.deleteImageFromDataFolder(profile.image1Path);
        }
        delete profile.image1Path;
      }
      if (settings.image2Path !== undefined) {
        // If old image exists and is different, delete it
        if (profile.image2Path && profile.image2Path !== settings.image2Path && profile.image2Path.includes(getPluginDataPath())) {
          this.deleteImageFromDataFolder(profile.image2Path);
        }
        profile.image2Path = settings.image2Path;
      } else if (settings.image2Path === undefined && oldSettings?.image2Path !== undefined) {
        // Image was explicitly removed
        if (profile.image2Path && profile.image2Path.includes(getPluginDataPath())) {
          this.deleteImageFromDataFolder(profile.image2Path);
        }
        delete profile.image2Path;
      }
      streamDeck.logger.info(`Updated profile "${newProfileId}" (new master)`);
    }

    // Save to persistent storage
    await this.saveProfilesToStorage();

    // IMMEDIATELY sync to all other buttons in this profile (including images)
    await this.syncProfileSettingsToAllButtons(newProfileId);
    
    // Update all button states (including THIS button that just changed)
    await this.updateAllProfileInstances(newProfileId);
  }

  private async findAndLoadProfileFromExistingButtons(profileId: string): Promise<VolumeProfile | null> {
    // Search through tracked action settings to find one with this profileId that has complete settings
    for (const [actionId, settings] of actionSettings.entries()) {
      if (settings.profileId === profileId && this.isSettingsConfigured(settings)) {
        // Found a button with this profile and complete settings!
        streamDeck.logger.info(`Found existing button ${actionId} with profile "${profileId}" - loading from it`);
        
        // Check if we have stored state for this profile
        const storedProfile = globalProfiles.get(profileId);
        
        return {
          deviceName: settings.deviceName!,
          volume1Left: settings.volume1Left!,
          volume1Right: settings.volume1Right!,
          volume2Left: settings.volume2Left!,
          volume2Right: settings.volume2Right!,
          currentState: storedProfile?.currentState ?? 0, // Use stored state if available
          isConfigured: true
        };
      }
    }
    
    streamDeck.logger.info(`No existing button found with profile "${profileId}"`);
    return null;
  }

  private isSettingsConfigured(settings: ActionSettings): boolean {
    // Settings are considered configured if deviceName and all volumes are present
    return !!(
      settings.deviceName &&
      settings.deviceName.trim() !== '' &&
      settings.volume1Left !== undefined &&
      settings.volume1Right !== undefined &&
      settings.volume2Left !== undefined &&
      settings.volume2Right !== undefined
    );
  }

  private settingsAreEqual(settings1: ActionSettings, settings2: ActionSettings): boolean {
    // Compare all relevant settings fields
    return (
      settings1.profileId === settings2.profileId &&
      settings1.deviceName === settings2.deviceName &&
      settings1.volume1Left === settings2.volume1Left &&
      settings1.volume1Right === settings2.volume1Right &&
      settings1.volume2Left === settings2.volume2Left &&
      settings1.volume2Right === settings2.volume2Right &&
      settings1.showText1 === settings2.showText1 &&
      settings1.showText2 === settings2.showText2 &&
      settings1.image1Path === settings2.image1Path &&
      settings1.image2Path === settings2.image2Path
    );
  }

  private getCurrentProfileId(actionId: string): string {
    // Find which profile this action belongs to
    for (const [profileId, contexts] of profileContexts.entries()) {
      if (contexts.has(actionId)) {
        return profileId;
      }
    }
    return actionId; // Fallback to action ID
  }

  private async getProfileImagePath(profileId: string, imageKey: 'image1Path' | 'image2Path'): Promise<string | undefined> {
    const contexts = profileContexts.get(profileId);
    if (!contexts) return undefined;

    // Find first button in this profile that has the image path
    for (const actionId of contexts) {
      const settings = actionSettings.get(actionId);
      if (settings && settings[imageKey]) {
        return settings[imageKey] as string;
      }
    }

    return undefined;
  }

  private async getProfileShowText(profileId: string, textKey: 'showText1' | 'showText2'): Promise<boolean | undefined> {
    const contexts = profileContexts.get(profileId);
    if (!contexts) return undefined;

    // Find first button in this profile that has the setting
    for (const actionId of contexts) {
      const settings = actionSettings.get(actionId);
      if (settings && settings[textKey] !== undefined) {
        return settings[textKey] as boolean;
      }
    }

    return undefined;
  }

  private async syncProfileSettingsToAllButtons(profileId: string): Promise<void> {
    const profile = globalProfiles.get(profileId);
    const contexts = profileContexts.get(profileId);
    
    if (!profile || !profile.isConfigured || !contexts) return;

    // Get the latest settings from the button that triggered the sync
    // to include image data
    let sourceSettings: ActionSettings | undefined;
    for (const actionId of contexts) {
      const settings = actionSettings.get(actionId);
      if (settings && this.isSettingsConfigured(settings)) {
        sourceSettings = settings;
        break;
      }
    }

    const syncedSettings: ActionSettings = {
      deviceName: profile.deviceName,
      volume1Left: profile.volume1Left,
      volume1Right: profile.volume1Right,
      volume2Left: profile.volume2Left,
      volume2Right: profile.volume2Right,
      // Get image paths from the profile
      image1Path: profile.image1Path,
      image2Path: profile.image2Path,
      showText1: sourceSettings?.showText1,
      showText2: sourceSettings?.showText2
    };

    // Update settings for all buttons in this profile
    const syncPromises = Array.from(contexts).map(async (actionId) => {
      const action = streamDeck.actions.getActionById(actionId);
      if (action) {
        const currentSettings = await action.getSettings() as ActionSettings;
        
        // Preserve the profileId from each button's settings
        const updatedSettings: ActionSettings = {
          ...syncedSettings,
          profileId: currentSettings.profileId
        };
        
        // Check if settings actually changed before updating
        const oldSettings = actionSettings.get(actionId);
        if (oldSettings && this.settingsAreEqual(oldSettings, updatedSettings)) {
          streamDeck.logger.info(`Button ${actionId} settings already up to date, skipping`);
          return;
        }
        
        // Update our tracking map
        actionSettings.set(actionId, updatedSettings);
        
        await action.setSettings(updatedSettings);
        
        // Notify Property Inspector if it's open and it's a KeyAction
        if ('sendToPropertyInspector' in action && typeof action.sendToPropertyInspector === 'function') {
          await (action as any).sendToPropertyInspector({
            event: 'settingsSynced',
            settings: updatedSettings
          });
        }
      }
    });

    await Promise.all(syncPromises);
    
    // After syncing settings, update all button states to apply images
    await this.updateAllProfileInstances(profileId);
    
    streamDeck.logger.info(`Synced settings (including images) to ${contexts.size} buttons in profile "${profileId}"`);
  }

  override async onKeyDown(ev: KeyDownEvent<ActionSettings>): Promise<void> {
    // Get the most up-to-date settings from our tracking map
    const storedSettings = actionSettings.get(ev.action.id);
    const settings = storedSettings || ev.payload.settings;
    
    // First, try to find which profile this button actually belongs to
    let profileId = settings.profileId || ev.action.id;
    
    // Double-check by looking in profileContexts
    for (const [pid, contexts] of profileContexts.entries()) {
      if (contexts.has(ev.action.id)) {
        profileId = pid;
        streamDeck.logger.info(`Button ${ev.action.id} found in profileContexts as "${pid}"`);
        break;
      }
    }
    
    streamDeck.logger.info(`KeyDown on button ${ev.action.id}, using profile "${profileId}" (from settings: "${settings.profileId || 'none'}")`);
    
    const profile = globalProfiles.get(profileId);

    if (!profile || !profile.isConfigured || !profile.deviceName) {
      await ev.action.showAlert();
      streamDeck.logger.warn(`Cannot toggle - profile "${profileId}" not configured. Profile exists: ${!!profile}, isConfigured: ${profile?.isConfigured}, deviceName: "${profile?.deviceName}"`);
      return;
    }

    // Toggle state
    const oldState = profile.currentState;
    profile.currentState = profile.currentState === 0 ? 1 : 0;
    const targetVolumeLeft = profile.currentState === 0 ? profile.volume1Left : profile.volume2Left;
    const targetVolumeRight = profile.currentState === 0 ? profile.volume1Right : profile.volume2Right;

    streamDeck.logger.info(`Toggling profile "${profileId}" from state ${oldState} to ${profile.currentState} (L:${targetVolumeLeft}% R:${targetVolumeRight}%)`);

    // Apply volume change
    try {
      await this.setVolume(profile.deviceName, targetVolumeLeft, targetVolumeRight);
      
      streamDeck.logger.info(`Volume set successfully, now updating all ${profileContexts.get(profileId)?.size || 0} buttons in profile`);
      
      // Save state to persistent storage
      await this.saveProfilesToStorage();
      
      // Update all instances of this profile IMMEDIATELY
      await this.updateAllProfileInstances(profileId);
      
      streamDeck.logger.info(`All buttons updated for profile "${profileId}"`);
    } catch (error) {
      streamDeck.logger.error('Failed to set volume:', error);
      await ev.action.showAlert();
      
      // Revert state
      profile.currentState = oldState;
    }
  }

  private async setVolume(deviceName: string, leftVolume: number, rightVolume: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const exePath = join(process.cwd(), 'SoundVolumeView.exe');
      
      const args = [
        '/SetVolumeChannels',
        deviceName,
        leftVolume.toString(),
        rightVolume.toString()
      ];

      streamDeck.logger.info(`Executing: ${exePath} ${args.join(' ')}`);

      const child = spawn(exePath, args, {
        windowsHide: true
      });

      let stderr = '';
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        streamDeck.logger.error(`Spawn error: ${error.message}`);
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          streamDeck.logger.info(`Successfully set volume to L:${leftVolume}% R:${rightVolume}% for ${deviceName}`);
          resolve();
        } else {
          const errorMsg = `SoundVolumeView exited with code ${code}. stderr: ${stderr}`;
          streamDeck.logger.error(errorMsg);
          reject(new Error(errorMsg));
        }
      });
    });
  }

  private async updateAllProfileInstances(profileId: string): Promise<void> {
    const contexts = profileContexts.get(profileId);
    if (!contexts) return;

    const updatePromises = Array.from(contexts).map(actionId => 
      this.updateButtonState(actionId, profileId)
    );

    await Promise.all(updatePromises);
  }

  private async updateButtonState(actionId: string, profileId: string): Promise<void> {
    const profile = globalProfiles.get(profileId);
    if (!profile) {
      streamDeck.logger.warn(`Cannot update button ${actionId} - profile "${profileId}" not found`);
      return;
    }

    const action = streamDeck.actions.getActionById(actionId);
    if (!action) {
      streamDeck.logger.warn(`Cannot update button ${actionId} - action not found`);
      return;
    }

    if (!profile.isConfigured) {
      // Not configured yet - show placeholder
      streamDeck.logger.info(`Button ${actionId} showing "Not Configured"`);
      await action.setTitle('Not\nConfigured');
      if ('setState' in action) {
        await action.setState(0);
      }
      return;
    }

    const state = profile.currentState;
    const volumeLeft = state === 0 ? profile.volume1Left : profile.volume2Left;
    const volumeRight = state === 0 ? profile.volume1Right : profile.volume2Right;

    streamDeck.logger.info(`Updating button ${actionId} to state ${state} (L:${volumeLeft}% R:${volumeRight}%)`);

    // Set button state (0 or 1)
    if ('setState' in action) {
      await action.setState(state);
    }

    // Get button's settings for display options
    const settings = actionSettings.get(actionId) || await action.getSettings() as ActionSettings;
    const showText = state === 0 ? (settings.showText1 !== false) : (settings.showText2 !== false);

    // Get the image for the current state
    const imagePath = state === 0 ? settings.image1Path : settings.image2Path;

    // Set the image FIRST (before title)
    if (imagePath) {
      streamDeck.logger.info(`Setting image for button ${actionId}: ${imagePath}`);
      await action.setImage(imagePath);
    } else {
      // No custom image - clear to show default from manifest
      streamDeck.logger.info(`Clearing custom image for button ${actionId}`);
      await action.setImage();
    }

    // Update title to show current volume (if enabled)
    if (showText) {
      const title = volumeLeft === volumeRight 
        ? `${volumeLeft}%` 
        : `L${volumeLeft}\nR${volumeRight}`;
      
      await action.setTitle(title);
    } else {
      await action.setTitle(''); // Clear title if text is disabled
    }
  }
}