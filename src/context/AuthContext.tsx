import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface AuthUser {
  id: string;
  username: string;
  role: "ADMIN" | "OPERATOR";
  name: string;
  createdAt: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  activeDevicesCount: number;
  token: string | null;
  login: (pinOrPassword: string, username?: string) => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<void>;
  updateCredentials: (currentSecret: string, newUsername?: string, newSecret?: string) => Promise<{ success: boolean; message: string }>;
}

const AUTH_STORAGE_KEY = "NEXVORA_TERMINAL_AUTH_TOKEN_V1";
const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEFAULT_USER: AuthUser = {
  id: "terminal-admin",
  username: "admin",
  role: "ADMIN",
  name: "Master Terminal Operator",
  createdAt: new Date().toISOString()
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(DEFAULT_USER);
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(AUTH_STORAGE_KEY) || "guest_terminal_token";
    } catch {
      return "guest_terminal_token";
    }
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [activeDevicesCount, setActiveDevicesCount] = useState<number>(1);

  const verifySession = useCallback(async (tokenToVerify: string) => {
    try {
      const res = await fetch("/api/auth/verify", {
        headers: {
          Authorization: `Bearer ${tokenToVerify}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user) {
          setUser(data.user);
          if (data.session?.activeDevicesCount) {
            setActiveDevicesCount(data.session.activeDevicesCount);
          }
          return true;
        }
      }
      // If server explicitly rejects token:
      setUser(DEFAULT_USER);
      return true;
    } catch (e) {
      // Offline fallback: If server unreachable, retain stored user state
      console.warn("Auth verification network error, offline fallback active");
      return true;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      verifySession(token);
    } else {
      setIsLoading(false);
    }
  }, [token, verifySession]);

  const login = async (pinOrPassword: string, username: string = "admin"): Promise<{ success: boolean; message: string }> => {
    setIsLoading(true);
    try {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const deviceName = isMobile ? "Mobile Device" : "Workstation Terminal";

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          pin: pinOrPassword,
          device: deviceName
        })
      });

      const data = await res.json();
      if (res.ok && data.success && data.token) {
        setToken(data.token);
        setUser(data.user);
        try {
          localStorage.setItem(AUTH_STORAGE_KEY, data.token);
        } catch {}
        setIsLoading(false);
        return { success: true, message: data.message || "Logged in successfully!" };
      }

      setIsLoading(false);
      return { success: false, message: data.message || "Invalid credentials." };
    } catch (err: any) {
      setIsLoading(false);
      return { success: false, message: "Connection to terminal server failed." };
    }
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    setUser(null);
    setToken(null);
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {}
  };

  const updateCredentials = async (currentSecret: string, newUsername?: string, newSecret?: string): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await fetch("/api/auth/update-credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ currentSecret, newUsername, newSecret })
      });
      const data = await res.json();
      if (data.success) {
        if (newUsername && user) {
          setUser({ ...user, username: newUsername });
        }
        return { success: true, message: data.message };
      }
      return { success: false, message: data.message || "Failed to update credentials." };
    } catch (e: any) {
      return { success: false, message: "Network error updating credentials." };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user && !!token,
        isLoading,
        activeDevicesCount,
        token,
        login,
        logout,
        updateCredentials
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
