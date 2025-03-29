import jwt from "jsonwebtoken";
import env from "../config/env.js";

export const authenticateToken = (req, res, next) => {
    const authHeader = req.header("Authorization");
    console.log("🔹 [Middleware] Authorization Header:", authHeader);

    if (!authHeader?.startsWith("Bearer ")) {
        console.error("❌ [Middleware] Thiếu hoặc sai định dạng Access Token");
        return res.status(401).json({ 
            success: false,
            message: "Thiếu hoặc sai định dạng Access Token" 
        });
    }

    const token = authHeader.split(" ")[1];
    console.log("🔹 [Middleware] Access Token:", token);

    // Sử dụng ACCESS_TOKEN_SECRET từ env
    jwt.verify(token, env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            if (err.name === "TokenExpiredError") {
                // Kiểm tra refresh token
                const refreshToken = req.cookies?.refreshToken;
                if (!refreshToken) {
                    console.error("❌ [Middleware] Không tìm thấy Refresh Token");
                    return res.status(401).json({ 
                        success: false,
                        message: "Phiên đăng nhập hết hạn, vui lòng đăng nhập lại" 
                    });
                }

                try {
                    // Verify refresh token
                    const decodedRefresh = jwt.verify(refreshToken, env.REFRESH_TOKEN_SECRET);
                    
                    // Tạo access token mới
                    const newAccessToken = jwt.sign(
                        { 
                            userId: decodedRefresh.userId,
                            role: decodedRefresh.role 
                        },
                        env.ACCESS_TOKEN_SECRET,
                        { expiresIn: "15m" } // Access token hết hạn sau 15 phút
                    );

                    // Gửi access token mới trong header
                    res.setHeader("New-Access-Token", newAccessToken);
                    
                    // Cập nhật user trong request
                    req.user = decodedRefresh;
                    next();
                } catch (refreshErr) {
                    console.error("❌ [Middleware] Refresh Token không hợp lệ:", refreshErr.message);
                    return res.status(401).json({ 
                        success: false,
                        message: "Phiên đăng nhập hết hạn, vui lòng đăng nhập lại" 
                    });
                }
            }
            console.error("❌ [Middleware] Token không hợp lệ:", err.message);
            return res.status(403).json({ 
                success: false,
                message: "Token không hợp lệ" 
            });
        }

        console.log("✅ [Middleware] Token decoded thành công:", decoded);
        req.user = decoded;
        next();
    });
};