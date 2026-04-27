import * as React from "react";

import { useState } from "react";

import { apiFetch } from "./api";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [status, setStatus] = useState("");



  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {

    e.preventDefault();

    setStatus("Logging in...");



    try {

      const data: any = await apiFetch("/auth/login", {

        method: "POST",

        body: JSON.stringify({ email, password }),

      });



      localStorage.setItem("token", data.token);
      // Enforce explicit school selection after login.
      localStorage.removeItem("schoolId");
      localStorage.removeItem("schoolsUsersPerms");
      localStorage.removeItem("payments");
      localStorage.removeItem("selectedInvoiceAccount");
      localStorage.removeItem("selectedStatementAccount");
      localStorage.removeItem("selectedInvoiceId");

      navigate("/select-school", { replace: true });

    } catch (err: any) {

      setStatus(err?.message || "Login failed");

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



        <button type="submit" style={{ padding: "8px 14px" }}>

          Login

        </button>

        <button
          type="button"
          onClick={() => navigate("/")}
          style={{ padding: "8px 14px", marginLeft: 10, background: "transparent", border: "1px solid #ccc" }}
        >
          Back
        </button>


        {status && <p style={{ marginTop: 12 }}>{status}</p>}

      </form>

    </div>

  );

}