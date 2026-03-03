import mongoose, { Schema, Document, Model } from "mongoose";



export interface IUser extends Document {

  email: string;

  passwordHash: string;

  role: "admin" | "user";

  createdAt: Date;

  updatedAt: Date;

}



const UserSchema = new Schema<IUser>(

  {

    email: { type: String, required: true, unique: true, lowercase: true, trim: true },

    passwordHash: { type: String, required: true },

    role: { type: String, enum: ["admin", "user"], default: "user" },

  },

  { timestamps: true }

);

const User =

  (mongoose.models.User as mongoose.Model<IUser>) ||

  mongoose.model<IUser>("User", UserSchema);



export default User;



