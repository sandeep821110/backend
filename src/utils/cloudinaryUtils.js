import cloudinary from '../config/cloudinary.js';

/**
 * Extract public_id from Cloudinary URL
 * @param {string} cloudinaryUrl - The full Cloudinary URL
 * @returns {string|null} - The extracted public_id or null if extraction fails
 */
export const extractPublicId = (cloudinaryUrl) => {
  try {
    if (!cloudinaryUrl || typeof cloudinaryUrl !== 'string') {
      return null;
    }

    // Handle different Cloudinary URL formats
    const url = new URL(cloudinaryUrl);
    const pathname = url.pathname;
    
    // Split the pathname and find the upload segment
    const pathParts = pathname.split('/');
    const uploadIndex = pathParts.findIndex(part => part === 'upload');
    
    if (uploadIndex === -1) {
      console.warn('Upload segment not found in URL:', cloudinaryUrl);
      return null;
    }
    
    // Get everything after the version (if present) or after upload
    let publicIdParts;
    if (uploadIndex + 1 < pathParts.length && pathParts[uploadIndex + 1].startsWith('v')) {
      // Version is present, skip it
      publicIdParts = pathParts.slice(uploadIndex + 2);
    } else {
      // No version, take everything after upload
      publicIdParts = pathParts.slice(uploadIndex + 1);
    }
    
    if (publicIdParts.length === 0) {
      console.warn('No public_id parts found in URL:', cloudinaryUrl);
      return null;
    }
    
    // Join the parts and remove file extension
    const publicIdWithExtension = publicIdParts.join('/');
    const publicId = publicIdWithExtension.replace(/\.[^/.]+$/, '');
    
    return publicId;
  } catch (error) {
    console.error('Error extracting public_id from URL:', cloudinaryUrl, error);
    return null;
  }
};

/**
 * Delete multiple images from Cloudinary
 * @param {string[]} imageUrls - Array of Cloudinary URLs
 * @returns {Promise<Array>} - Array of deletion results
 */
export const deleteCloudinaryImages = async (imageUrls) => {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    console.log('No images to delete');
    return [];
  }

  const deletionResults = [];
  
  for (const imageUrl of imageUrls) {
    try {
      const publicId = extractPublicId(imageUrl);
      
      if (!publicId) {
        console.warn(`Could not extract public_id from URL: ${imageUrl}`);
        continue;
      }
      
      console.log(`Attempting to delete image with public_id: ${publicId}`);
      
      const result = await cloudinary.uploader.destroy(publicId, {
        invalidate: true,
        resource_type: "image"
      });
      
      if (result.result === 'ok') {
        console.log(`Successfully deleted image: ${publicId}`);
        deletionResults.push({
          success: true,
          url: imageUrl,
          publicId,
          message: 'Image deleted successfully'
        });
      } else {
        console.warn(`Failed to delete image: ${publicId}`, result);
        deletionResults.push({
          success: false,
          url: imageUrl,
          publicId,
          message: `Deletion failed: ${result.result}`
        });
      }
    } catch (error) {
      console.error(`Error deleting image ${imageUrl}:`, error);
      deletionResults.push({
        success: false,
        url: imageUrl,
        message: `Error: ${error.message}`
      });
    }
  }
  
  return deletionResults;
};
