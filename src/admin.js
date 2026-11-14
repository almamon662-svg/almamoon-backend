
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
// IMAGE UPLOAD
// =====================================

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

  return data.publicUrl;
}


// =====================================
// IMAGE SETTINGS VALIDATION
// =====================================

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
// UPLOAD PRODUCT
// =====================================

router.post(
  "/products",
  upload.fields([
    { name: "pdf", maxCount: 1 },
    { name: "image", maxCount: 1 }
  ]),
  async (req, res) => {
    let uploadedPdfPath = null;

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

      if (!title?.trim() || price === undefined || price === "" || !pdf) {
        return res.status(400).json({
          error: "Title, price and PDF are required"
        });
      }

      if (!Number.isFinite(Number(price)) || Number(price) < 0) {
        return res.status(400).json({
          error: "Invalid product price"
        });
      }

      const selectedCurrency = currency || "USD";

      if (!CURRENCIES.includes(selectedCurrency)) {
        return res.status(400).json({
          error: "Unsupported currency"
        });
      }

      if (pdf.mimetype !== "application/pdf") {
        return res.status(400).json({
          error: "Only PDF files are allowed"
        });
      }

      const safePdfName = pdf.originalname.replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );

      uploadedPdfPath = `${Date.now()}-${safePdfName}`;

      const { error: pdfError } = await supabase.storage
        .from("digital-products")
        .upload(uploadedPdfPath, pdf.buffer, {
          contentType: "application/pdf",
          upsert: false
        });

      if (pdfError) throw pdfError;

      let imageUrl = null;

      if (image) {
        imageUrl = await uploadCover(image);
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

      res.status(500).json({
        error: "Product upload failed. Check server logs."
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

      const updateData = {
        title: title.trim(),
        subtitle: subtitle || "",
        category: category.trim(),
        updated_at: new Date().toISOString(),
        ...getImageSettings(req.body, "cover")
      };

      if (req.file) {
        updateData.image_url = await uploadCover(
          req.file,
          "highlights"
        );
      }

      const { data, error } = await supabase
        .from("homepage_highlights")
        .update(updateData)
        .eq("position", position)
        .select()
        .single();

      if (error) throw error;

      res.json({
        message: "Highlight card updated successfully",
        highlight: data
      });

    } catch (error) {
      console.error("HIGHLIGHT_UPDATE_ERROR:", error.message);

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
