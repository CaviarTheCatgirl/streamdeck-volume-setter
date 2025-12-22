# Volume Setter for Stream Deck

A Stream Deck plugin that allows you to quickly switch between two volume presets for any audio device, with per-channel (left/right) control and profile syncing across multiple buttons.

## Features

- 🎚️ **Dual Volume Presets**: Toggle between two different volume levels with a single button press
- 🔊 **Per-Channel Control**: Set independent left and right channel volumes for audio balance
- 🔄 **Profile Syncing**: Link multiple buttons with the same Profile ID - pressing any one updates all of them
- 🖼️ **Custom Images**: Upload custom icons for each state that sync across all linked buttons
- 💾 **Persistent State**: Your volume states persist across Stream Deck restarts
- 📊 **Visual Feedback**: See current volume levels displayed on the button (optional)

## Installation

### Download from Releases
1. Go to the [Releases](https://github.com/CaviarTheCatgirl/volume-setter/releases) page
2. Download the latest `com.caviarthecatgirl.volume-setter.streamDeckPlugin` file
3. Double-click the downloaded file to install

### Build from Source
1. Clone this repository
2. Install dependencies: `npm install`
3. Build the plugin: `npm run build`
4. The plugin will be in the `com.caviarthecatgirl.volume-setter.sdPlugin` folder

## Usage

### Basic Setup
1. Drag the "Volume Toggle" action to a button on your Stream Deck
2. In the Property Inspector:
   - Enter your **Audio Device Name** (must match exactly as shown in Windows Sound Settings)
   - Set **Volume Level 1** (Left and Right channels, 0-100%)
   - Set **Volume Level 2** (Left and Right channels, 0-100%)
3. Press the button to toggle between the two volume presets

### Finding Your Device Name
1. Open Windows Sound Settings (Right-click speaker icon in taskbar → Sounds)
2. Go to "Playback" tab
3. Find your device and copy its exact name (e.g., "Kopfhörer & Lautsprecher")
4. Paste this name into the "Audio Device Name" field

### Profile Syncing (Optional)
To sync multiple buttons:
1. Set up your first button as usual
2. Add more buttons to your Stream Deck
3. Give them all the **same Profile ID** (e.g., "headphones")
4. All buttons with the same Profile ID will:
   - Toggle together (pressing any one updates all)
   - Share the same volume settings
   - Share the same custom images

### Custom Images (Optional)
1. In the Property Inspector, click "Choose Image" for State 1 or State 2
2. Select an image file (PNG, JPG, GIF recommended)
3. The image will sync to all buttons with the same Profile ID
4. Click "Remove" to delete a custom image and return to the default

## Requirements

- **Platform**: Windows only
- **Stream Deck Software**: Version 6.0 or later
- **Note**: This plugin uses SoundVolumeView (included) which only works on Windows

## Configuration Options

| Setting | Description | Required |
|---------|-------------|----------|
| Profile ID | Identifier to sync multiple buttons together | No |
| Audio Device Name | Exact name of your audio device from Windows | Yes |
| Volume Level 1 (L/R) | First volume preset (0-100% per channel) | Yes |
| Volume Level 2 (L/R) | Second volume preset (0-100% per channel) | Yes |
| State 1 Image | Custom icon for first state | No |
| State 2 Image | Custom icon for second state | No |

## Troubleshooting

### Button shows "Not Configured"
- Make sure all required fields are filled in (Device Name and all four volume values)
- Device name must match exactly (including spaces and special characters)

### Volume doesn't change
- Verify the device name matches exactly in Windows Sound Settings
- Make sure the device is set as the default playback device
- Try unplugging and replugging the device

### Images don't sync
- Ensure all buttons have the **exact same** Profile ID
- Try clicking the "Sync Now" button in the Property Inspector
- Remove and re-add the button

### Button doesn't toggle all synced buttons
- All buttons must be on your currently active Stream Deck profile
- Check that Profile IDs match exactly (case-sensitive)

## Development

### Building
```bash
npm install
npm run build
```

### File Structure

- volume-setter/
- ├── src/
- │   ├── plugin.ts              # Main plugin entry
- │   ├── actions/
- │   │   └── volume-toggle-action.ts
- │   └── property-inspector.html
- ├── com.caviarthecatgirl.volume-setter.sdPlugin/
- │   ├── bin/                   # Compiled JavaScript
- │   ├── imgs/                  # Plugin icons
- │   ├── SoundVolumeView.exe    # Volume control utility
- │   └── manifest.json          # Plugin metadata
- └── package.json

### Technologies Used
- TypeScript
- Stream Deck SDK (@elgato/streamdeck)
- SoundVolumeView (NirSoft)

## Credits

- **Plugin Author**: CaviarTheCatgirl
- **Volume Control**: [SoundVolumeView by NirSoft](https://www.nirsoft.net/utils/sound_volume_view.html)

## License

MIT License - See [LICENSE](LICENSE) file for details

**Note**: SoundVolumeView is bundled with this plugin and is freeware by NirSoft.

## Support

If you encounter any issues or have suggestions:
- Open an issue on [GitHub Issues](https://github.com/CaviarTheCatgirl/volume-setter/issues)
- Provide your Stream Deck version and a description of the problem

## Changelog

See [RELEASES](https://github.com/CaviarTheCatgirl/volume-setter/releases) for version history.

---

**Enjoy your Volume Setter plugin! 🎚️🔊**
