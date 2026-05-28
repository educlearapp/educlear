import * as React from "react";

import { useState } from "react";

import { useNavigate } from "react-router-dom";

import { apiFetch } from "./api";
import { clearEduClearRole, syncEduClearRoleFromLoginResponse } from "./auth/roles";
import {
  clearMigrationAccess,
  syncMigrationAccessFromLoginResponse,
} from "./auth/migrationAccess";
import {
  clearSubscriptionGateCache,
  resolvePostAuthPath,
} from "./subscriptions/subscriptionsApi";
import { cacheSchoolLogoUrl } from "./utils/schoolLogo";



type Props = {

  onLoggedIn: () => void;

};



export default function Login({ onLoggedIn }: Props) {

  const navigate = useNavigate();

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [status, setStatus] = useState("");

  const [loading, setLoading] = useState(false);



  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {

    e.preventDefault();

    setStatus("Logging in...");

    setLoading(true);

    clearEduClearRole();
    clearMigrationAccess();



    try {

      const data: any = await apiFetch("/auth/login", {

        method: "POST",

        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),

      });



      console.log("[Login] response", data);



      const token = data?.token;

      const schoolId =
        data?.schoolId ?? data?.school?.id ?? data?.user?.schoolId;



      if (!token) {

        throw new Error("Login response missing token. Please try again.");

      }



      if (!schoolId) {

        throw new Error(

          "Your account is not linked to a school. Please contact support."

        );

      }



      localStorage.setItem("token", String(token));

      localStorage.setItem("schoolId", String(schoolId));

      const u = data?.user;
      if (u?.email) localStorage.setItem("userEmail", String(u.email));
      if (u?.fullName != null) localStorage.setItem("userName", String(u.fullName));
      if (u?.role != null) localStorage.setItem("userRole", String(u.role));
      if (u?.id) localStorage.setItem("userId", String(u.id));



      const schoolName =
        data?.school?.name ?? data?.schoolName ?? data?.user?.schoolName;

      if (schoolName) {

        localStorage.setItem("schoolName", String(schoolName));

      }



      const logoUrl = data?.school?.logoUrl;

      if (logoUrl) {
        cacheSchoolLogoUrl(String(logoUrl));
      }

      syncEduClearRoleFromLoginResponse(data);
      syncMigrationAccessFromLoginResponse(data);



      onLoggedIn();

      clearSubscriptionGateCache();
      const nextPath = await resolvePostAuthPath(String(schoolId));
      navigate(nextPath);

    } catch (err: any) {

      setStatus(err?.message || "Login failed");

    } finally {

      setLoading(false);

    }

  };



  return (

    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>

      <h2>Login</h2>



      <form onSubmit={handleLogin}>

        <div style={{ marginBottom: 12 }}>

          <label>Email</label>

          <input

            style={{ width: "100%", padding: 8 }}

            value={email}

            onChange={(e) => setEmail(e.target.value)}

            autoComplete="username"

          />

        </div>



        <div style={{ marginBottom: 12 }}>

          <label>Password</label>

          <input

            style={{ width: "100%", padding: 8 }}

            type="password"

            value={password}

            onChange={(e) => setPassword(e.target.value)}

            autoComplete="current-password"

          />

        </div>



        <button type="submit" style={{ padding: "8px 14px" }} disabled={loading}>

          Login

        </button>



        {status && <p style={{ marginTop: 12 }}>{status}</p>}

      </form>

    </div>

  );

}
