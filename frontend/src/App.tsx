import { useEffect, useState } from "react";

import Login from "./Login";



type School = {

  id: number | string;

  name?: string;

};



export default function App() {

  const token = localStorage.getItem("token");

  const [schools, setSchools] = useState<School[]>([]);

  const [error, setError] = useState("");



  useEffect(() => {

    if (!token) return;



    fetch("http://localhost:3000/api/schools", {

      headers: {

        Authorization: `Bearer ${token}`,

      },

    })

      .then((res) => {

        if (!res.ok) throw new Error("Failed to fetch schools");

        return res.json();

      })

      .then((data) => {

        setSchools(Array.isArray(data) ? data : data.schools || []);

      })

      .catch((err) => {

        setError(err.message);

      });

  }, [token]);



  if (!token) {

    return <Login onLoggedIn={() => window.location.reload()} />;

  }



  return (

    <div style={{ textAlign: "center", marginTop: 60 }}>

      <h1>EduClear System</h1>

      <h2>Welcome — Logged In ✅</h2>



      <button

        onClick={() => {

          localStorage.removeItem("token");

          window.location.reload();

        }}

      >

        Logout

      </button>



      <div style={{ marginTop: 30 }}>

        <h3>Schools</h3>

        {error ? (

          <p>{error}</p>

        ) : (

          <pre>{JSON.stringify(schools, null, 2)}</pre>

        )}

      </div>

    </div>

  );

}


