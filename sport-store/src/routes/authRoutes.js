import express from "express";
import passport from "passport";
import jwt from "jsonwebtoken";
import env from "../config/env.js";
import User from "../models/user.js";
import { 
  register, 
  verifyOTP, 
  login, 
  logout, 
  forgotPassword, 
  verifyForgotPasswordOTP, 
  requestUpdate, 
  updateUser, 
  refreshToken, 
  verifyToken 
} from "../controllers/authController.js";
import { authenticateToken } from "../middlewares/authenticateToken.js";

const router = express.Router();

// Kiểm tra route hoạt động
router.get("/", (req, res) => {
    res.json({ message: "Route xác thực đang hoạt động!" });
});

// Đăng ký tài khoản mới (Gửi OTP qua email)
router.post("/register", register);

// Xác thực OTP để kích hoạt tài khoản
router.post("/verify-account", verifyOTP);

// Đăng nhập tài khoản
router.post("/login", login);

// Đăng xuất tài khoản
router.post("/logout", logout);

// Quên mật khẩu (Gửi OTP qua email)
router.post("/forgot-password", forgotPassword);

// Xác thực OTP quên mật khẩu & nhận token để đổi mật khẩu
router.post("/verify-forgot-password-otp", verifyForgotPasswordOTP);

// Gửi OTP để xác thực trước khi thay đổi thông tin bảo mật
router.post("/request-update", authenticateToken, requestUpdate); // ✅ Thêm `authenticateToken`

// Xác thực OTP và cập nhật thông tin bảo mật (email, username, password)
router.put("/update-user", authenticateToken, updateUser); // ✅ Thêm `authenticateToken`

// Route bắt đầu đăng nhập Google
router.get(
    "/google",
    passport.authenticate("google", { scope: ["profile", "email"] })
);

// Route xử lý callback sau khi Google xác thực thành công
router.get(
    "/google/callback",
    passport.authenticate("google", { session: false }),
    (req, res) => {
        if (!req.user) {
            return res.status(400).json({ message: "Xác thực Google thất bại" });
        }

        // 📌 Tạo JWT token
        const token = jwt.sign(
            { userId: req.user._id, email: req.user.email },
            env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        // 🔒 Gửi token qua HTTP-only cookie thay vì URL
        res.cookie("authToken", token, {
            httpOnly: true,
            secure: env.NODE_ENV === "production",
            sameSite: "Lax",
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 ngày
        });

        // 📌 Chuyển hướng về FE mà không để lộ token
        res.redirect(`${env.FRONTEND_URL}/user/auth/google-success`);
    }
);

// Lấy thông tin user từ token
router.get("/profile", authenticateToken, async (req, res) => {
  try {
      // Tìm user trong database
      const user = await User.findById(req.user.userId).select("-password -refreshToken");
      
      if (!user) {
          return res.status(404).json({ message: "Không tìm thấy người dùng" });
      }

      res.json({ message: "User Profile", user });
  } catch (error) {
      res.status(500).json({ message: "Lỗi server", error: error.message });
  }
});

// Xác thực token
router.post("/verify-token", verifyToken);

// Refresh token
router.post("/refresh", refreshToken);

export default router;