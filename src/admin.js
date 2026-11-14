
const express = require("express");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

const CURRENCIES = [
  "USD", "BDT", "EUR", "GBP",
  "CAD", "AUD", "INR", "AED",
  "SAR", "MYR", "SGD", "JPY",
  "CNY", "PKR"
];

const HIGHLIGHT_POSITIONS = [1, 2, 3, 4, 5];

function adminAuth(req, res, next) {
  const token = req.headers.authorization;

  if (
    !process.env.ADMIN_SECRET ||
    !token ||
    token !== `Bearer ${process.env.ADMIN_SECRET}`
  ) {
    return res.status(401).json({
      error: "Unauthorized admin access"
    });
  }

  next();
}

router.use(adminAuth);


// =====================================
// COMMON HELPERS
// =====================================

function parseBoolean(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function validatePrice(value) {
  return (
    value !== undefined &&
    value !== "" &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0
  );
}

async function uploadCover(file, folder = "covers") {
  if (!file) return null;

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (!allowedTypes.includes(file.mimetype)) {
    throw new Error("Only JPG, PNG and WEBP images are allowed");
  }

  const safeName = file.originalname.replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );

  const imagePath = `${folder}/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from("product-covers")
    .upload(imagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from("product-covers")
    .getPublicUrl(imagePath);

  return {
    path: imagePath,
    url: data.publicUrl
  };
}

async function uploadPdf(file) {
  if (!file) return null;

  if (file.mimetype !== "application/pdf") {
    throw new Error("Only PDF files are allowed");
  }

  const safeName = file.originalname.replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );

  const pdfPath = `${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from("digital-products")
    .upload(pdfPath, file.buffer, {
      contentType: "application/pdf",
      upsert: false
    });

  if (error) throw error;

  return pdfPath;
}

function getImageSettings(body, defaultFit) {
  const settings = {};

  const fields = [
    ["image_position_x", "imagePositionX"],
    ["image_position_y", "imagePositionY"],
    ["image_zoom", "imageZoom"]
  ];

  for (const [column, field] of fields) {
    if (body[field] !== undefined || body[column] !== undefined) {
      const value = Number(body[field] ?? body[column]);

      if (!Number.isFinite(value)) {
        throw new Error(`Invalid ${field}`);
      }

      if (column === "image_zoom") {
        if (value < 1 || value > 3) {
          throw new Error("Zoom must be between 1 and 3");
        }
      } else if (value < 0 || value > 100) {
        throw new Error(`${field} must be between 0 and 100`);
      }

      settings[column] = value;
    }
  }

  const fit = body.imageFit ?? body.image_fit;

  if (fit !== undefined) {
    if (!["contain", "cover", "fill"].includes(fit)) {
      throw new Error("Invalid image fit");
    }

    settings.image_fit = fit;
  } else if (defaultFit) {
    settings.image_fit = defaultFit;
  }

  return settings;
}


// =====================================
// CURRENCIES
// =====================================

router.get("/currencies", (req, res) => {
  res.json({
    default: "USD",
    currencies: CURRENCIES
  });
});


// =====================================
// WEBSITE SETTINGS
// =====================================

// Load all saved website settings
router.get("/settings", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("site_settings")
      .select("settings, updated_at")
      .eq("id", "main")
      .maybeSingle();

    if (error) throw error;

    res.json({
      settings: data?.settings || {},
      updated_at: data?.updated_at || null
    });

  } catch (error) {
    console.error("ADMIN_SETTINGS_GET_ERROR:", error.message);

    res.status(500).json({
      error: "Could not load website settings"
    });
  }
});


// Save or update website settings
router.put("/settings", async (req, res) => {
  try {
    const newSettings = req.body?.settings;

    if (
      !newSettings ||
      typeof newSettings !== "object" ||
      Array.isArray(newSettings)
    ) {
      return res.status(400).json({
        error: "Settings must be a valid JSON object"
      });
    }

    const { data: existing, error: readError } = await supabase
      .from("site_settings")
      .select("settings")
      .eq("id", "main")
      .maybeSingle();

    if (readError) throw readError;

    const mergedSettings = {
      ...(existing?.settings || {}),
      ...newSettings
    };

    const { data, error } = await supabase
      .from("site_settings")
      .upsert({
        id: "main",
        settings: mergedSettings,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: "Website settings saved successfully",
      settings: data.settings
    });

  } catch (error) {
    console.error("ADMIN_SETTINGS_SAVE_ERROR:", error.message);

    res.status(500).json({
      error: "Could not save website settings"
    });
  }
});


// =====================================
// GET PRODUCTS
// =====================================

router.get("/products", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select(`
        id,
        title,
        description,
        price,
        currency,
        category,
        image_url,
        pdf_path,
        image_position_x,
        image_position_y,
        image_zoom,
        image_fit,
        active,
        featured_order,
        created_at
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);

  } catch (error) {
    console.error("ADMIN_PRODUCTS_ERROR:", error.message);

    res.status(500).json({
      error: "Could not load admin products"
    });
  }
});


// =====================================
// UPLOAD NEW PRODUCT
// =====================================

router.post(
  "/products",
  upload.fields([
    { name: "pdf", maxCount: 1 },
    { name: "image", maxCount: 1 }
  ]),
  async (req, res) => {
    let uploadedPdfPath = null;
    let uploadedImagePath = null;

    try {
      const {
        title,
        description,
        price,
        currency,
        category
      } = req.body;

      const pdf = req.files?.pdf?.[0];
      const image = req.files?.image?.[0];

      if (!title?.trim() || !validatePrice(price) || !pdf) {
        return res.status(400).json({
          error: "Title, valid price and PDF are required"
        });
      }

      const selectedCurrency = currency || "USD";

      if (!CURRENCIES.includes(selectedCurrency)) {
        return res.status(400).json({
          error: "Unsupported currency"
        });
      }

      uploadedPdfPath = await uploadPdf(pdf);

      let imageUrl = null;

      if (image) {
        const uploadedImage = await uploadCover(image);
        imageUrl = uploadedImage.url;
        uploadedImagePath = uploadedImage.path;
      }

      const { data, error } = await supabase
        .from("products")
        .insert({
          title: title.trim(),
          description: description || "",
          price: Number(price),
          currency: selectedCurrency,
          category: category?.trim() || "Other",
          image_url: imageUrl,
          pdf_path: uploadedPdfPath,
          active: true,
          image_position_x: 50,
          image_position_y: 50,
          image_zoom: 1,
          image_fit: "contain"
        })
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        message: "Product uploaded successfully",
        product: data
      });

    } catch (error) {
      console.error("PRODUCT_UPLOAD_ERROR:", error);

      if (uploadedPdfPath) {
        await supabase.storage
          .from("digital-products")
          .remove([uploadedPdfPath]);
      }

      if (uploadedImagePath) {
        await supabase.storage
          .from("product-covers")
          .remove([uploadedImagePath]);
      }

      res.status(500).json({
        error: error.message || "Product upload failed"
      });
    }
  }
);


// =====================================
// EDIT EXISTING PRODUCT
// =====================================

router.put(
  "/products/:id",
  upload.fields([
    { name: "pdf", maxCount: 1 },
    { name: "image", maxCount: 1 }
  ]),
  async (req, res) => {
    let uploadedPdfPath = null;
    let uploadedImagePath = null;

    try {
      const productId = req.params.id;

      const { data: oldProduct, error: findError } = await supabase
        .from("products")
        .select("id, pdf_path, image_url")
        .eq("id", productId)
        .single();

      if (findError) throw findError;

      const updateData = {};

      const editableFields = [
        "title",
        "description",
        "category"
      ];

      for (const field of editableFields) {
        if (req.body[field] !== undefined) {
          if (
            typeof req.body[field] !== "string" ||
            (field === "title" && !req.body[field].trim())
          ) {
            return res.status(400).json({
              error: `Invalid ${field}`
            });
          }

          updateData[field] =
            field === "title" || field === "category"
              ? req.body[field].trim()
              : req.body[field];
        }
      }

      if (req.body.price !== undefined) {
        if (!validatePrice(req.body.price)) {
          return res.status(400).json({
            error: "Invalid product price"
          });
        }

        updateData.price = Number(req.body.price);
      }

      if (req.body.currency !== undefined) {
        if (!CURRENCIES.includes(req.body.currency)) {
          return res.status(400).json({
            error: "Unsupported currency"
          });
        }

        updateData.currency = req.body.currency;
      }

      if (req.body.active !== undefined) {
        const active = parseBoolean(req.body.active);

        if (active === null) {
          return res.status(400).json({
            error: "Invalid active status"
          });
        }

        updateData.active = active;
      }

      Object.assign(
        updateData,
        getImageSettings(req.body)
      );

      const newImage = req.files?.image?.[0];
      const newPdf = req.files?.pdf?.[0];

      if (newImage) {
        const uploadedImage = await uploadCover(newImage);
        uploadedImagePath = uploadedImage.path;
        updateData.image_url = uploadedImage.url;
      }

      if (req.body.removeImage === "true") {
        updateData.image_url = null;
      }

      if (newPdf) {
        uploadedPdfPath = await uploadPdf(newPdf);
        updateData.pdf_path = uploadedPdfPath;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          error: "No changes provided"
        });
      }

      const { data, error } = await supabase
        .from("products")
        .update(updateData)
        .eq("id", productId)
        .select()
        .single();

      if (error) throw error;

      // Remove replaced files after successful database update.
      if (newPdf && oldProduct.pdf_path) {
        await supabase.storage
          .from("digital-products")
          .remove([oldProduct.pdf_path]);
      }

      if (
        (newImage || req.body.removeImage === "true") &&
        oldProduct.image_url
      ) {
        // Only remove files stored in our product-covers bucket.
        const marker = "/storage/v1/object/public/product-covers/";

        if (oldProduct.image_url.includes(marker)) {
          const oldImagePath = oldProduct.image_url.split(marker)[1];

          if (oldImagePath) {
            await supabase.storage
              .from("product-covers")
              .remove([decodeURIComponent(oldImagePath)]);
          }
        }
      }

      res.json({
        message: "Product updated successfully",
        product: data
      });

    } catch (error) {
      console.error("PRODUCT_UPDATE_ERROR:", error);

      if (uploadedPdfPath) {
        await supabase.storage
          .from("digital-products")
          .remove([uploadedPdfPath]);
      }

      if (uploadedImagePath) {
        await supabase.storage
          .from("product-covers")
          .remove([uploadedImagePath]);
      }

      res.status(500).json({
        error: error.message || "Could not update product"
      });
    }
  }
);


// =====================================
// UPDATE PRODUCT IMAGE SETTINGS
// =====================================

router.patch("/products/:id/image-settings", async (req, res) => {
  try {
    const settings = getImageSettings(req.body);

    if (Object.keys(settings).length === 0) {
      return res.status(400).json({
        error: "No image settings provided"
      });
    }

    const { data, error } = await supabase
      .from("products")
      .update(settings)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: "Product image settings saved",
      product: data
    });

  } catch (error) {
    console.error("PRODUCT_IMAGE_SETTINGS_ERROR:", error.message);

    res.status(400).json({
      error: error.message || "Could not save product image settings"
    });
  }
});


// =====================================
// UPDATE PRODUCT CATEGORY
// =====================================

router.patch("/products/:id/category", async (req, res) => {
  try {
    const category = req.body.category;

    if (typeof category !== "string" || !category.trim()) {
      return res.status(400).json({
        error: "A valid category is required"
      });
    }

    const { data, error } = await supabase
      .from("products")
      .update({ category: category.trim() })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: "Product category updated",
      product: data
    });

  } catch (error) {
    console.error("CATEGORY_UPDATE_ERROR:", error.message);

    res.status(500).json({
      error: "Could not update product category"
    });
  }
});


// =====================================
// TOP 5 PRODUCTS
// =====================================

router.put("/products/featured", async (req, res) => {
  try {
    const { productIds } = req.body;

    if (
      !Array.isArray(productIds) ||
      productIds.length !== 5 ||
      new Set(productIds).size !== 5 ||
      productIds.some(id => typeof id !== "string")
    ) {
      return res.status(400).json({
        error: "Select exactly 5 different products"
      });
    }

    const { data: products, error: fetchError } = await supabase
      .from("products")
      .select("id, active")
      .in("id", productIds);

    if (fetchError) throw fetchError;

    if (
      products.length !== 5 ||
      products.some(product => !product.active)
    ) {
      return res.status(400).json({
        error: "All five selected products must exist and be active"
      });
    }

    const { error: clearError } = await supabase
      .from("products")
      .update({ featured_order: null })
      .not("featured_order", "is", null);

    if (clearError) throw clearError;

    for (let i = 0; i < productIds.length; i++) {
      const { error } = await supabase
        .from("products")
        .update({ featured_order: i + 1 })
        .eq("id", productIds[i]);

      if (error) throw error;
    }

    res.json({
      message: "Homepage Top 5 updated successfully",
      productIds
    });

  } catch (error) {
    console.error("FEATURED_PRODUCTS_ERROR:", error.message);

    res.status(500).json({
      error: "Could not update Top 5 products"
    });
  }
});


// =====================================
// GET HIGHLIGHTS
// =====================================

router.get("/highlights", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("homepage_highlights")
      .select("*")
      .order("position", { ascending: true });

    if (error) throw error;

    res.json(data);

  } catch (error) {
    console.error("ADMIN_HIGHLIGHTS_ERROR:", error.message);

    res.status(500).json({
      error: "Could not load highlight cards"
    });
  }
});


// =====================================
// UPDATE HIGHLIGHT + IMAGE SETTINGS
// =====================================

router.put(
  "/highlights/:position",
  upload.single("image"),
  async (req, res) => {
    let uploadedImagePath = null;

    try {
      const position = Number(req.params.position);

      if (!HIGHLIGHT_POSITIONS.includes(position)) {
        return res.status(400).json({
          error: "Invalid highlight position"
        });
      }

      const { title, subtitle, category } = req.body;

      if (
        typeof title !== "string" ||
        !title.trim() ||
        typeof category !== "string" ||
        !category.trim()
      ) {
        return res.status(400).json({
          error: "Title and category are required"
        });
      }

      const { data: oldHighlight, error: oldError } = await supabase
        .from("homepage_highlights")
        .select("image_url")
        .eq("position", position)
        .single();

      if (oldError) throw oldError;

      const updateData = {
        title: title.trim(),
        subtitle: subtitle || "",
        category: category.trim(),
        updated_at: new Date().toISOString(),
        ...getImageSettings(req.body, "cover")
      };

      if (req.file) {
        const uploadedImage = await uploadCover(
          req.file,
          "highlights"
        );

        uploadedImagePath = uploadedImage.path;
        updateData.image_url = uploadedImage.url;
      }

      const { data, error } = await supabase
        .from("homepage_highlights")
        .update(updateData)
        .eq("position", position)
        .select()
        .single();

      if (error) throw error;

      if (req.file && oldHighlight.image_url) {
        const marker = "/storage/v1/object/public/product-covers/";

        if (oldHighlight.image_url.includes(marker)) {
          const oldImagePath = oldHighlight.image_url.split(marker)[1];

          if (oldImagePath) {
            await supabase.storage
              .from("product-covers")
              .remove([decodeURIComponent(oldImagePath)]);
          }
        }
      }

      res.json({
        message: "Highlight card updated successfully",
        highlight: data
      });

    } catch (error) {
      console.error("HIGHLIGHT_UPDATE_ERROR:", error.message);

      if (uploadedImagePath) {
        await supabase.storage
          .from("product-covers")
          .remove([uploadedImagePath]);
      }

      res.status(400).json({
        error: error.message || "Could not update highlight card"
      });
    }
  }
);


// =====================================
// END
// =====================================

module.exports = router;
