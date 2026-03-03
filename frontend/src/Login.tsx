import React, { useState, type FormEvent } from "react";

import { apiFetch } from "./api";



type Props = {

  onLoggedIn: () => void;

};



export default function Login({ onLoggedIn }: Props) {

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [status, setStatus] = useState("");



  const handleLogin = async (e: FormEvent) => {

    e.preventDefault();

    setStatus("Logging in...");



    try {

      const data: any = await apiFetch("/auth/login", {

        method: "POST",

        body: JSON.stringify({ email, password }),

      });



      // token could be named token or accessToken depending on backend

      const token = data?.token || data?.accessToken;



      if (!token) {

        setStatus("Login failed: token missing");

        console.log("LOGIN RESPONSE:", data);

        return;

      }



      localStorage.setItem("token", token);

      setStatus("Logged in ✅");

      onLoggedIn();

    } catch (err: any) {

      console.error("LOGIN ERROR:", err);

      setStatus(err?.message || "Login failed ❌");

    }

  };



  return (

    <div style={{ textAlign: "center", marginTop: 50 }}>

      <h1>EduClear Login</h1>



      <form onSubmit={handleLogin}>

        <input

          placeholder="Email"

          value={email}

          onChange={(e) => setEmail(e.target.value)}

          style={{ padding: 10, width: 260, marginBottom: 10 }}

        />

        <br />

        <input

          placeholder="Password"

          type="password"

          value={password}

          onChange={(e) => setPassword(e.target.value)}

          style={{ padding: 10, width: 260, marginBottom: 10 }}

        />

        <br />

        <button type="submit">Login</button>

      </form>



      <p>{status}</p>

    </div>

  );

}