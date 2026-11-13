
require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PORT = process.env.PORT || 5000;

const SSL_URL =
  process.env.SSLCOMMERZ_IS_LIVE === "true"
    ? "https://securepay.sslcommerz.com"
    : "https://sandbox.sslcommerz.com";

// Home
app.get("/", (req, res) => {
  res.send("Welcome to Almamoon Backend!");
});

// Get all active products
app.get("/api/products", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("id, title, description, price, currency, image_url")
      .eq("active", true);

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Could not load products" });
  }
});

// Create checkout
app.post("/api/checkout", async (req, res) => {
  try {
    const { product_id, customer_name, customer_email } = req.body;

    if (!product_id || !customer_name || !customer_email) {
      return res.status(400).json({
        error: "Missing customer or product information"
      });
    }

    const { data: product, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", product_id)
      .eq("active", true)
      .single();

    if (error || !product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const tran_id = "ALM" + Date.now();

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        tran_id,
        product_id,
        amount: product.price,
        currency: product.currency || "BDT",
        customer_name,
        customer_email,
        status: "PENDING"
      })
      .select()
      .single();

    if (orderError) throw orderError;

    const paymentData = {
      store_id: process.env.SSLCOMMERZ_STORE_ID,
      store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD,
      total_amount: product.price,
      currency: product.currency || "BDT",
      tran_id,
      success_url: `${process.env.SERVER_URL}/payment/success`,
      fail_url: `${process.env.SERVER_URL}/payment/fail`,
      cancel_url: `${process.env.SERVER_URL}/payment/cancel`,
      ipn_url: `${process.env.SERVER_URL}/payment/ipn`,
      cus_name: customer_name,
      cus_email: customer_email,
      cus_add1: "Bangladesh",
      cus_city: "Chattogram",
      cus_country: "Bangladesh",
      cus_phone: "01700000000",
      shipping_method: "NO",
      product_name: product.title,
      product_category: "Digital Product",
      product_profile: "general"
    };

    const response = await axios.post(
      `${SSL_URL}/gwprocess/v4/api.php`,
      new URLSearchParams(paymentData).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    if (
      response.data.status !== "SUCCESS" ||
      !response.data.GatewayPageURL
    ) {
      throw new Error("Payment session creation failed");
    }

    res.json({
      checkout_url: response.data.GatewayPageURL,
      order_id: order.id
    });

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "Checkout failed" });
  }
});

// Payment success return
app.post("/payment/success", (req, res) => {
  res.send("Payment submitted. Verification is pending.");
});

// Payment failed
app.post("/payment/fail", (req, res) => {
  res.send("Payment failed. Please try again.");
});

// Payment cancelled
app.post("/payment/cancel", (req, res) => {
  res.send("Payment cancelled.");
});

// Payment IPN verification
app.post("/payment/ipn", async (req, res) => {
  try {
    const { val_id, tran_id } = req.body;

    if (!val_id || !tran_id) {
      return res.status(400).send("Missing payment details");
    }

    const validation = await axios.get(
      `${SSL_URL}/validator/api/validationserverAPI.php`,
      {
        params: {
          val_id,
          store_id: process.env.SSLCOMMERZ_STORE_ID,
          store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD,
          format: "json"
        }
      }
    );

    const payment = validation.data;

    const { data: order, error } = await supabase
      .from("orders")
      .select("*")
      .eq("tran_id", tran_id)
      .single();

    if (error || !order) {
      return res.status(404).send("Order not found");
    }

    const valid =
      ["VALID", "VALIDATED"].includes(payment.status) &&
      payment.tran_id === order.tran_id &&
      Number(payment.amount) === Number(order.amount) &&
      payment.currency === order.currency;

    if (!valid) {
      return res.status(400).send("Payment verification failed");
    }

    if (order.status !== "PAID") {
      const { error: updateError } = await supabase
        .from("orders")
        .update({ status: "PAID" })
        .eq("id", order.id)
        .eq("status", "PENDING");

      if (updateError) throw updateError;
    }

    res.send("Payment verified");

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("IPN verification failed");
  }
});

// Secure PDF download
app.get("/api/download/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    const { data: order, error } = await supabase
      .from("orders")
      .select("status, customer_email, product_id")
      .eq("id", orderId)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (
      order.status !== "PAID" ||
      order.customer_email.toLowerCase() !== String(email).toLowerCase()
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("pdf_path")
      .eq("id", order.product_id)
      .single();

    if (productError || !product?.pdf_path) {
      return res.status(404).json({ error: "PDF not found" });
    }

    const { data: signed, error: signedError } = await supabase
      .storage
      .from("digital-products")
      .createSignedUrl(product.pdf_path, 60);

    if (signedError) throw signedError;

    res.json({ download_url: signed.signedUrl });

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Download failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Almamoon Backend running on port ${PORT}`);
});
