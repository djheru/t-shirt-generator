import sharp from 'sharp';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 't-shirt-generator' });

/**
 * Configuration for background removal
 */
export interface BackgroundRemovalConfig {
  /** Color threshold for determining if a pixel is "white" (0-255). Default: 250 */
  readonly threshold?: number;
  /** Whether to apply edge feathering for smoother edges. Default: true */
  readonly featherEdges?: boolean;
  /** Radius for edge feathering in pixels. Default: 1 */
  readonly featherRadius?: number;
}

const DEFAULT_CONFIG: Required<BackgroundRemovalConfig> = {
  threshold: 250,
  featherEdges: true,
  featherRadius: 1,
};

/**
 * Remove white background from an image and replace with true alpha transparency.
 *
 * This is necessary because AI image generators cannot produce true PNG transparency.
 * Instead, we ask them to generate on a solid white background, then remove it here.
 *
 * @param imageBuffer - PNG image buffer with white background
 * @param config - Optional configuration for background removal
 * @returns PNG image buffer with transparent background
 */
export const removeWhiteBackground = async (
  imageBuffer: Buffer,
  config: BackgroundRemovalConfig = {}
): Promise<Buffer> => {
  const { threshold, featherEdges, featherRadius } = { ...DEFAULT_CONFIG, ...config };

  logger.debug('Removing white background from image', {
    inputSize: imageBuffer.length,
    threshold,
    featherEdges,
    featherRadius,
  });

  try {
    // Get image metadata and raw pixel data
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Unable to read image dimensions');
    }

    const { width, height } = metadata;

    // Extract raw RGBA pixel data
    const { data: rawData, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Create new buffer for output with alpha channel
    const outputData = Buffer.from(rawData);
    const channels = info.channels;

    // Process each pixel
    for (let i = 0; i < rawData.length; i += channels) {
      const r = rawData[i];
      const g = rawData[i + 1];
      const b = rawData[i + 2];

      // Check if pixel is "white" (all RGB values above threshold)
      if (r >= threshold && g >= threshold && b >= threshold) {
        // Make fully transparent
        outputData[i + 3] = 0;
      }
    }

    // Apply edge feathering if enabled to smooth transitions
    if (featherEdges) {
      applyEdgeFeathering(outputData, width, height, channels, featherRadius);
    }

    // Reconstruct PNG with transparency
    const result = await sharp(outputData, {
      raw: {
        width,
        height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();

    logger.debug('Background removal complete', {
      inputSize: imageBuffer.length,
      outputSize: result.length,
    });

    return result;
  } catch (error) {
    logger.error('Failed to remove background', { error });
    throw error;
  }
};

/**
 * Apply edge feathering to smooth the transition between opaque and transparent pixels.
 * This reduces harsh edges that can occur when removing backgrounds.
 */
const applyEdgeFeathering = (
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  radius: number
): void => {
  // Create a copy of alpha values for reference
  const originalAlpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels + 3;
      originalAlpha[y * width + x] = data[idx];
    }
  }

  // For each pixel, if it's at the edge of a transparent region, soften it
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels + 3;
      const currentAlpha = originalAlpha[y * width + x];

      // Only process fully opaque pixels that might be at an edge
      if (currentAlpha === 255) {
        let hasTransparentNeighbor = false;

        // Check neighbors within radius
        for (let dy = -radius; dy <= radius && !hasTransparentNeighbor; dy++) {
          for (let dx = -radius; dx <= radius && !hasTransparentNeighbor; dx++) {
            if (dx === 0 && dy === 0) continue;

            const nx = x + dx;
            const ny = y + dy;

            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              if (originalAlpha[ny * width + nx] === 0) {
                hasTransparentNeighbor = true;
              }
            }
          }
        }

        // If this pixel is adjacent to transparent pixels, partially feather it
        if (hasTransparentNeighbor) {
          // Count how many neighbors are transparent
          let transparentCount = 0;
          let totalNeighbors = 0;

          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              if (dx === 0 && dy === 0) continue;

              const nx = x + dx;
              const ny = y + dy;

              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                totalNeighbors++;
                if (originalAlpha[ny * width + nx] === 0) {
                  transparentCount++;
                }
              }
            }
          }

          // Reduce alpha based on how surrounded by transparency this pixel is
          const ratio = transparentCount / totalNeighbors;
          if (ratio > 0.3) {
            // Only feather if significantly surrounded
            data[idx] = Math.round(255 * (1 - ratio * 0.5));
          }
        }
      }
    }
  }
};

/**
 * Process multiple images to remove white backgrounds.
 *
 * @param images - Array of PNG image buffers
 * @param config - Optional configuration for background removal
 * @returns Array of PNG image buffers with transparent backgrounds
 */
export const removeWhiteBackgroundBatch = async (
  images: Buffer[],
  config: BackgroundRemovalConfig = {}
): Promise<Buffer[]> => {
  logger.info('Removing white backgrounds from batch', {
    imageCount: images.length,
  });

  const results = await Promise.all(
    images.map((img) => removeWhiteBackground(img, config))
  );

  logger.info('Batch background removal complete', {
    imageCount: results.length,
  });

  return results;
};
