
const express = require("express");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Temporary memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// Admin authentication
function adminAuth(req, res, next) {
  const token = req.headers.authorization;

  if (
    !token ||
    token !== `Bearer ${process.env.ADMIN_SECRET}`
  ) {
    return res.status(401).json({
      error: "Unauthorized admin access"
    });
  }

  next();
}

// Upload product
router.post(
  "/products",
  adminAuth,
  upload.fields([
    { name: "pdf", maxCount: 1 },
    { name: "image", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const { title, description, price, currency } = req.body;

      if (!title || !price || !req.files?.pdf?.[0]) {
        return res.status(400).json({
          error: "Title, price and PDF are required"
        });
      }

      const pdf = req.files.pdf[0];

      if (pdf.mimetype !== "application/pdf") {
        return res.status(400).json({
          error: "Only PDF files are allowed"
        });
      }

      const pdfPath = `${Date.now()}-${pdf.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

      const { error: pdfError } = await supabase.storage
        .from("digital-products")
        .upload(pdfPath, pdf.buffer, {
          contentType: "application/pdf",
          upsert: false
        });

      if (pdfError) throw pdfError;

      let imageUrl = null;

      if (req.files.image?.[0]) {
        const image = req.files.image[0];

        if (!["image/jpeg", "image/png", "image/webp"].includes(image.mimetype)) {
          throw new Error("Invalid image format");
        }

        const imagePath = `covers/${Date.now()}-${image.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

        const { error: imageError } = await supabase.storage
          .from("product-covers")
          .upload(imagePath, image.buffer, {
            contentType: image.mimetype,
            upsert: false
          });

        if (imageError) throw imageError;

        const { data: imageData } = supabase.storage
          .from("product-covers")
          .getPublicUrl(imagePath);

        imageUrl = imageData.publicUrl;
      }

      const { data, error } = await supabase
        .from("products")
        .insert({
          title,
          description,
          price: Number(price),
          currency: currency || "BDT",
          image_url: imageUrl,
          pdf_path: pdfPath,
          active: true
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

  res.status(500).json({
    error: "Product upload failed. Check server logs."
  });
}
   
  }
);

module.exports = router;
