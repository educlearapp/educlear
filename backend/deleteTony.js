const { PrismaClient } = require("@prisma/client");



const prisma = new PrismaClient();



async function main() {

  const result = await prisma.parent.deleteMany({

    where: {

      firstName: "Tony",

    },

  });



  console.log("Deleted:", result);

}



main()

  .catch((e) => {

    console.error(e);

  })

  .finally(async () => {

    await prisma.$disconnect();

  });