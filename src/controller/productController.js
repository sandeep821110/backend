import Product from '../models/productModel.js';
import cloudinary from '../config/cloudinary.js';
import { deleteCloudinaryImages } from '../utils/cloudinaryUtils.js';

// Create product
export const createProduct = async (req, res) => {
  try {
    console.log('Request Files:', req.files);
    console.log('Request Body:', req.body);
    
    
    const {
      productCode,
      name,
      price,
      description,
      category,
      subCategory,
      rating,
      brand,
      bestSeller,
      discount
    } = req.body;

    // Validate files — helpful debug if missing
    if (req.filesMissing || !req.files || !Array.isArray(req.files) || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one image file is required',
        hints: [
          "Use Body -> form-data in Postman (not raw JSON)",
          "Field name must be 'images' (repeat key for multiple files)",
          "Do not set Content-Type manually — let Postman/browser set boundary",
          `Request Content-Type: ${req.uploadDebug?.contentType || req.headers['content-type'] || ''}`
        ],
        filesReceived: req.files?.length || 0
      });
    }

    // Validate file types
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const invalidFiles = req.files.filter(file => !allowedTypes.includes(file.mimetype));
    
    if (invalidFiles.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Only JPG, PNG and WEBP are allowed',
        invalidFiles: invalidFiles.map(f => f.originalname)
      });
    }

    // Parse sizeQuantity with better error handling
    let sizeQuantity;
    try {
      sizeQuantity = typeof req.body.sizeQuantity === 'string' 
        ? JSON.parse(req.body.sizeQuantity) 
        : req.body.sizeQuantity;
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sizeQuantity format',
        error: error.message,
        received: req.body.sizeQuantity,
        example: [{ size: "M", quantity: 10 }]
      });
    }

    // Validate required fields
    if (!productCode || !name || !price || !description || !category || !subCategory || !brand) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Validate sizeQuantity
    if (!Array.isArray(sizeQuantity) || sizeQuantity.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one size and quantity is required',
        example: [{ size: "M", quantity: 10 }]
      });
    }

    // Validate each size entry
    if (!sizeQuantity.every(item => 
      item.size && 
      typeof item.quantity === 'number' && 
      item.quantity >= 0
    )) {
      return res.status(400).json({
        success: false,
        message: 'Invalid size or quantity values'
      });
    }

    // Process image uploads with error handling
    const imageUrls = [];
    const uploadErrors = [];

    for (const file of req.files) {
      try {
        // Assuming file.path is the Cloudinary URL after upload
        if (file.path) {
          imageUrls.push(file.path);
        } else {
          uploadErrors.push(`Failed to upload ${file.originalname}`);
        }
      } catch (error) {
        uploadErrors.push(`Error uploading ${file.originalname}: ${error.message}`);
      }
    }

    if (uploadErrors.length > 0) {
      // Clean up any successful uploads
      await Promise.all(imageUrls.map(url => cloudinary.uploader.destroy(url)));
      
      return res.status(400).json({
        success: false,
        message: 'Error uploading images',
        errors: uploadErrors
      });
    }

    const product = await Product.create({
      productCode: productCode.trim(),
      name: name.trim(),
      price: Number(price),
      description: description.trim(),
      category: category.trim(),
      subCategory: subCategory.trim(),
      rating: Number(rating) || 1,
      image: imageUrls,
      sizeQuantity,
      brand: brand.trim(),
      bestSeller: bestSeller === 'true' || bestSeller === true,
      discount: Number(discount) || 0
    });

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product,
      uploadedFiles: req.files.map(f => ({
        name: f.originalname,
        size: f.size,
        url: f.path
      }))
    });

  } catch (error) {
    console.error('Product creation error:', error);
    
    // Clean up uploaded images if there's an error
    if (req.files?.length) {
      await Promise.all(req.files.map(file => {
        if (file.path) {
          return cloudinary.uploader.destroy(file.path);
        }
      }));
    }

    res.status(500).json({
      success: false,
      message: 'Error creating product',
      error: error.message,
      requestBody: req.body,
      filesReceived: req.files?.length || 0
    });
  }
};

// Get all products
export const getAllProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      category,
      subCategory,
      brand,
      minPrice,
      maxPrice,
      bestSeller,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search
    } = req.query;

    // Build filter object
    const filter = {};
    
    if (category) filter.category = new RegExp(category, 'i');
    if (subCategory) filter.subCategory = new RegExp(subCategory, 'i');
    if (brand) filter.brand = new RegExp(brand, 'i');
    if (bestSeller !== undefined) filter.bestSeller = bestSeller === 'true';
    
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    if (search) {
      filter.$or = [
        { name: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') },
        { brand: new RegExp(search, 'i') }
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Calculate pagination
    const skip = (Number(page) - 1) * Number(limit);

    // Get products with pagination
    const products = await Product.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit));

    // Get total count for pagination info
    const totalProducts = await Product.countDocuments(filter);
    const totalPages = Math.ceil(totalProducts / Number(limit));

    res.status(200).json({
      success: true,
      count: products.length,
      totalProducts,
      totalPages,
      currentPage: Number(page),
      hasNextPage: Number(page) < totalPages,
      hasPrevPage: Number(page) > 1,
      products
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching products',
      error: error.message
    });
  }
};

// Get single product
export const getProduct = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID format'
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.status(200).json({
      success: true,
      product
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching product',
      error: error.message
    });
  }
};

// Update product
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID format'
      });
    }

    const existingProduct = await Product.findById(id);
    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const updateData = { ...req.body };

    // Handle sizeQuantity update
    if (updateData.sizeQuantity) {
      try {
        updateData.sizeQuantity = typeof updateData.sizeQuantity === 'string'
          ? JSON.parse(updateData.sizeQuantity)
          : updateData.sizeQuantity;

        if (!Array.isArray(updateData.sizeQuantity) || !updateData.sizeQuantity.every(item => 
          item.size && typeof item.quantity === 'number' && item.quantity >= 0
        )) {
          return res.status(400).json({
            success: false,
            message: 'Invalid sizeQuantity format'
          });
        }
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid sizeQuantity data'
        });
      }
    }

    // Handle image updates
    if (req.files?.length) {
      const newImageUrls = req.files.map(file => file.path);
      
      if (updateData.replaceImages === 'true') {
        await deleteCloudinaryImages(existingProduct.image);
        updateData.image = newImageUrls;
      } else {
        updateData.image = [...existingProduct.image, ...newImageUrls];
      }
    } else if (updateData.existingImages !== undefined) {
      // No new files, but client sent an explicit kept-image list -> persist removals
      try {
        const kept = typeof updateData.existingImages === 'string'
          ? JSON.parse(updateData.existingImages)
          : updateData.existingImages;

        if (Array.isArray(kept)) {
          const removed = existingProduct.image.filter(url => !kept.includes(url));
          if (removed.length > 0) {
            await deleteCloudinaryImages(removed);
          }
          updateData.image = kept;
        }
      } catch (parseError) {
        console.error('Invalid existingImages payload:', parseError);
      }
    }

    // Convert numeric fields
    if (updateData.price) updateData.price = Number(updateData.price);
    if (updateData.rating) updateData.rating = Number(updateData.rating);
    if (updateData.discount) updateData.discount = Number(updateData.discount);
    if (updateData.bestSeller) updateData.bestSeller = updateData.bestSeller === 'true';

    delete updateData.replaceImages;
    delete updateData.existingImages;

    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      product: updatedProduct
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating product',
      error: error.message
    });
  }
};

// Delete product
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID format'
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    console.log('Deleting product:', product.name);
    console.log('Images to delete:', product.image);

    // Delete images from Cloudinary
    let imageDeletionResults = [];
    if (product.image && product.image.length > 0) {
      imageDeletionResults = await deleteCloudinaryImages(product.image);
      
      // Log results
      const successfulDeletions = imageDeletionResults.filter(result => result.success).length;
      const failedDeletions = imageDeletionResults.filter(result => !result.success).length;
      
      console.log(`Image deletion summary: ${successfulDeletions} successful, ${failedDeletions} failed`);
      
      if (failedDeletions > 0) {
        console.warn('Some images could not be deleted from Cloudinary:', 
          imageDeletionResults.filter(result => !result.success)
        );
      }
    }

    // Delete the product from database
    await Product.findByIdAndDelete(id);
    console.log('Product deleted from database successfully');

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully',
      imageDeletionResults: imageDeletionResults
    });
  } catch (error) {
    console.error('Product deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting product',
      error: error.message
    });
  }
};


export const updateProductStock = async (req, res) => {
  try {
    const { productId } = req.params;
    const { sizeQuantity } = req.body;

    if (!Array.isArray(sizeQuantity)) {
      return res.status(400).json({
        success: false,
        message: 'sizeQuantity must be an array'
      });
    }

    // Validate sizeQuantity entries
    for (const item of sizeQuantity) {
      if (!item.size || typeof item.quantity !== 'number' || item.quantity < 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid size or quantity value'
        });
      }
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    product.sizeQuantity = sizeQuantity;
    await product.save();

    res.status(200).json({
      success: true,
      message: 'Product stock updated successfully',
      sizeQuantity: product.sizeQuantity,
      totalStock: product.totalStock
    });

  } catch (error) {
    console.error('Stock update error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating stock',
      error: error.message
    });
  }
};