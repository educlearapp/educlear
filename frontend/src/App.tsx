import "./App.css";

import { useMemo, useState } from "react";

import SchoolDashboard from "./SchoolDashboard";
import TeacherPerformance from "./TeacherPerformance";
type Parent = {

  id: number;

  parentType: string;

  fullName: string;

  idNumber: string;

  mobile: string;

  email: string;

  address: string;

  occupation: string;

  employer: string;

  billingResponsible: boolean;

  primaryContact: boolean;

};



type Sibling = {

  id: number;

  firstName: string;

  surname: string;

  learnerIdNumber: string;

  gender: string;

  grade: string;

  birthDate: string;

  homeLanguage: string;

  nationality: string;

  religion: string;

  enrolmentDate: string;

  notes: string;

};



type FeeItem = {

  id: number;

  feeName: string;

  amount: string;

  frequency: string;

  discount: string;

};



function App() {

  const [firstName, setFirstName] = useState("");

  const [surname, setSurname] = useState("");

  const [learnerIdNumber, setLearnerIdNumber] = useState("");

  const [gender, setGender] = useState("");

  const [grade, setGrade] = useState("");

  const [birthDate, setBirthDate] = useState("");

  const [homeLanguage, setHomeLanguage] = useState("");

  const [nationality, setNationality] = useState("");

  const [religion, setReligion] = useState("");

  const [enrolmentDate, setEnrolmentDate] = useState("");

  const [notes, setNotes] = useState("");



  const [parents, setParents] = useState<Parent[]>([]);

  const [siblings, setSiblings] = useState<Sibling[]>([]);

  const [fees, setFees] = useState<FeeItem[]>([]);

  const [message, setMessage] = useState("");



  const [familyReference, setFamilyReference] = useState("");

    
  


  const totalFees = useMemo(() => {

    return fees.reduce((sum, fee) => {

      const amount = parseFloat(fee.amount || "0");

      const discount = parseFloat(fee.discount || "0");

      return sum + Math.max(amount - discount, 0);

    }, 0);

  }, [fees]);



  const addParent = () => {

    setParents((prev) => [

      ...prev,

      {

        id: Date.now(),

        parentType: "Mother",

        fullName: "",

        idNumber: "",

        mobile: "",

        email: "",

        address: "",

        occupation: "",

        employer: "",

        billingResponsible: false,

        primaryContact: false,

      },

    ]);

  };



  const updateParent = (

    id: number,

    field: keyof Parent,

    value: string | boolean

  ) => {

    setParents((prev) =>

      prev.map((parent) =>

        parent.id === id ? { ...parent, [field]: value } : parent

      )
    );
  };



  const removeParent = (id: number) => {

    setParents((prev) => prev.filter((parent) => parent.id !== id));

  };



  const addSibling = () => {

    setSiblings((prev) => [
  
      ...prev,
  
      {
  
        id: Date.now(),
  
        firstName: "",
  
        surname: "",
  
        learnerIdNumber: "",
  
        gender: "",
  
        grade: "",
  
        birthDate: "",
  
        homeLanguage: "",
  
        nationality: "",
  
        religion: "",
  
        enrolmentDate: "",
  
        notes: "",
  
      },
  
    ]);
  
  };



  const updateSibling = (

    id: number,
  
    field: keyof Sibling,
  
    value: string
  
  ) => {
  
    setSiblings((prev) =>
  
      prev.map((sibling) =>
  
        sibling.id === id
  
          ? { ...sibling, [field]: value }
  
          : sibling
  
      )
  
    );
  
  };



  const removeSibling = (id: number) => {

    setSiblings((prev) => prev.filter((sibling) => sibling.id !== id));

  };



  const addFee = () => {

    setFees((prev) => [

      ...prev,

      {

        id: Date.now(),

        feeName: "",

        amount: "",

        frequency: "Monthly",

        discount: "",

      },

    ]);

  };



  const updateFee = (id: number, field: keyof FeeItem, value: string) => {

    setFees((prev) =>

      prev.map((fee) => (fee.id === id ? { ...fee, [field]: value } : fee))

    );

  };



  const removeFee = (id: number) => {

    setFees((prev) => prev.filter((fee) => fee.id !== id));

  };



  const handleSave = async (e: React.FormEvent) => {

    e.preventDefault();
  
  
  
    try {
  
      const payload = {
  
      
  
        learner: {
  
          firstName,
  
          surname,
  
          learnerIdNumber,
  
          gender,
  
          grade,
  
          birthDate,
  
          homeLanguage,
  
          nationality,
  
          religion,
  
          enrolmentDate,
  
          notes,
  
        },
  
        parents,
  
        siblings,
  
        fees,
  
        totalFees,
  
      };
  
  
  
      const res = await fetch("http://localhost:3000/learner", {
  
        method: "POST",
  
        headers: {
  
          "Content-Type": "application/json",
  
        },
  
        body: JSON.stringify(payload),
  
      });
  
  
  
      const data = await res.json();
  
  
  
      if (res.ok) {
  
        setMessage("Saved! Account Ref: " + data.familyReference);
  
  
  
        // ✅ CLEAR FORM
  
        setFirstName("");
  
        setSurname("");
  
        setLearnerIdNumber("");
  
        setGender("");
  
        setGrade("");
  
        setBirthDate("");
  
        setHomeLanguage("");
  
        setNationality("");
  
        setReligion("");
  
        setEnrolmentDate("");
  
        setNotes("");
  
  
  
        setParents([]);
  
        setSiblings([]);
  
        setFees([]);
  
    
  
  
  
      } else {
  
        setMessage("Error saving learner");
  
      }
  
  
  
    } catch (err) {
  
      console.error(err);
  
      setMessage("Server error");
  
    }
  
  };



 return <TeacherPerformance />;

}



export default App;