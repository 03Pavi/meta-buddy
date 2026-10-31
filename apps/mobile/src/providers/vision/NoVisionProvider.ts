import type { VisionProvider } from '../types';

/**
 * Placeholder used while no multimodal model is configured. The on-device Gemma 3 1B build is text-only
 * (its metadata reports supportsMultimodal: false), so this provider never claims to see an image.
 */
export class NoVisionProvider implements VisionProvider {
  readonly id = 'none';
  readonly supportsImages = false;

  async describe(): Promise<string> {
    throw new Error('No vision model is configured. Ask without the camera.');
  }
}
