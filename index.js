const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.urlencoded({ extended: true }));

// PostgreSQL pool setup with your connection string
const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_9Zzi7NRVQIvF@ep-tiny-scene-a8imp2sk-pooler.eastus2.azure.neon.tech/neondb?sslmode=require",
  ssl: {
    rejectUnauthorized: false, // sometimes needed for cloud SSL connections
  }
});

// Application states
const STATES = {
  LANGUAGE_SELECTION: 'LANGUAGE_SELECTION',
  WEIGHT_INPUT: 'WEIGHT_INPUT',
  HEIGHT_INPUT: 'HEIGHT_INPUT',
  BMI_RESULT: 'BMI_RESULT',
  TIPS_SELECTION: 'TIPS_SELECTION',
  PREVIOUS_RECORD: 'PREVIOUS_RECORD'
};

// Localized messages
const MESSAGES = {
  en: {
    welcome: "Welcome to BMI App\n1. English\n2. Kinyarwanda",
    weight_input: "Enter your weight in KGs:\n0. Back",
    height_input: "Enter your height in CMs:\n0. Back",
    invalid_weight: "Invalid weight. Please enter a number between 10-500 kg:\n0. Back",
    invalid_height: "Invalid height. Please enter a number between 50-300 cm:\n0. Back",
    tips_question: "Would you like health tips?\n1. Yes\n2. No\n0. Back",
    new_check: "1. New check\n2. Exit",
    thank_you: "Thank you for using BMI App!",
    underweight: "You are underweight.",
    normal: "You are normal.",
    overweight: "You are overweight.",
    obese: "You are obese.",
    underweight_tips: "Eat more calories, proteins, nuts and dairy.",
    normal_tips: "Maintain healthy eating and stay active.",
    overweight_tips: "Eat more greens, reduce sugar and fat.",
    obese_tips: "Avoid processed foods and consult a doctor.",
    invalid_input: "Invalid input. Please try again.",
    db_error: "System error. Please try again later."
  },
  rw: {
    welcome: "Murakaza neza kuri BMI App\n1. English\n2. Kinyarwanda",
    weight_input: "Andika ibiro byawe (KG):\n0. Subira inyuma",
    height_input: "Andika uburebure bwawe (CM):\n0. Subira inyuma",
    invalid_weight: "Ibiro utanze ntibyemewe. Andika umubare uri hagati ya 10-500 kg:\n0. Subira inyuma",
    invalid_height: "Uburebure utanze ntibwemewe. Andika umubare uri hagati ya 50-300 cm:\n0. Subira inyuma",
    tips_question: "Wifuza inama z'ubuzima?\n1. Yego\n2. Oya\n0. Subira inyuma",
    new_check: "1. Tangira bushya\n2. Sohoka",
    thank_you: "Murakoze gukoresha BMI App!",
    underweight: "Ufite ibiro biri hasi cyane.",
    normal: "Ufite ibiro bisanzwe.",
    overweight: "Ufite ibiro birenze.",
    obese: "Ufite ibiro byinshi cyane.",
    underweight_tips: "Fata ibirimo intungamubiri nyinshi nka ubunyobwa.",
    normal_tips: "Komereza aho! Fata indyo yuzuye kandi ukore siporo.",
    overweight_tips: "Fata imboga nyinshi, gabanya isukari n'amavuta.",
    obese_tips: "Irinde ibiribwa byatunganyijwe kandi ushake inama kwa muganga.",
    invalid_input: "Icyo watanze nticyemewe. Gerageza ukundi.",
    db_error: "Hari ikosa. Gerageza ukundi nyuma."
  }
};

// Helper functions
function getMessage(lang, key) {
  return MESSAGES[lang] ? MESSAGES[lang][key] : MESSAGES.en[key];
}

function validateWeight(weight) {
  const w = parseFloat(weight);
  return !isNaN(w) && w >= 10 && w <= 500;
}

function validateHeight(height) {
  const h = parseFloat(height);
  return !isNaN(h) && h >= 50 && h <= 300;
}

function calculateBMI(weight, height) {
  return +(weight / ((height / 100) ** 2)).toFixed(1);
}

function getBMIStatus(bmi, lang) {
  if (bmi < 18.5) return getMessage(lang, 'underweight');
  if (bmi < 25) return getMessage(lang, 'normal');
  if (bmi < 30) return getMessage(lang, 'overweight');
  return getMessage(lang, 'obese');
}

function getBMITips(bmi, lang) {
  if (bmi < 18.5) return getMessage(lang, 'underweight_tips');
  if (bmi < 25) return getMessage(lang, 'normal_tips');
  if (bmi < 30) return getMessage(lang, 'overweight_tips');
  return getMessage(lang, 'obese_tips');
}

function getStateFromInput(user, steps, currentStep) {
  if (!user) {
    return currentStep === 0 ? STATES.LANGUAGE_SELECTION : STATES.WEIGHT_INPUT;
  }

  // For existing users, determine state based on their current_state and input
  switch (user.current_state) {
    case STATES.LANGUAGE_SELECTION:
      return STATES.PREVIOUS_RECORD;
    case STATES.PREVIOUS_RECORD:
      return steps[1] === '1' ? STATES.WEIGHT_INPUT : null; // null means exit
    case STATES.WEIGHT_INPUT:
      return STATES.HEIGHT_INPUT;
    case STATES.HEIGHT_INPUT:
      return STATES.BMI_RESULT;
    case STATES.BMI_RESULT:
      return STATES.TIPS_SELECTION;
    case STATES.TIPS_SELECTION:
      return null; // End of flow
    default:
      return STATES.PREVIOUS_RECORD;
  }
}

function handleBackButton(user, steps) {
  if (!user) {
    return steps.length <= 1 ? STATES.LANGUAGE_SELECTION : STATES.WEIGHT_INPUT;
  }

  switch (user.current_state) {
    case STATES.HEIGHT_INPUT:
      return STATES.WEIGHT_INPUT;
    case STATES.BMI_RESULT:
      return STATES.HEIGHT_INPUT;
    case STATES.TIPS_SELECTION:
      return STATES.BMI_RESULT;
    default:
      return STATES.PREVIOUS_RECORD;
  }
}

// Use async handler for express POST route
app.post("/", async (req, res) => {
  const { sessionId, phoneNumber, text } = req.body;
  let steps = text.trim() === "" ? [] : text.trim().split("*");
  let input = steps[steps.length - 1];
  let currentStep = steps.length;

  if (input === "0" && currentStep > 1) {
    steps = steps.slice(0, -2);
    currentStep = steps.length;
    input = steps[steps.length - 1] || "";
  }

  try {
    const client = await pool.connect();

    // Get user by phoneNumber
    const userResult = await client.query(
      "SELECT * FROM users WHERE phone_number = $1",
      [phoneNumber]
    );
    const user = userResult.rows[0];

    // Determine current state
    let currentState;
    if (input === "0" && currentStep >= 1) {
      currentState = handleBackButton(user, steps);
    } else {
      currentState = getStateFromInput(user, steps, currentStep);
    }

    switch (currentState) {
      case STATES.LANGUAGE_SELECTION:
        res.send("CON " + getMessage('en', 'welcome'));
        break;

      case STATES.WEIGHT_INPUT:
        if (!user && currentStep === 1) {
          const lang = steps[0] === "2" ? "rw" : "en";
          await client.query(
            "INSERT INTO users (phone_number, language, current_state) VALUES ($1, $2, $3)",
            [phoneNumber, lang, STATES.WEIGHT_INPUT]
          );
          res.send("CON " + getMessage(lang, 'weight_input'));
        } else if (user) {
          await client.query(
            "UPDATE users SET current_state = $1 WHERE id = $2",
            [STATES.WEIGHT_INPUT, user.id]
          );
          res.send("CON " + getMessage(user.language, 'weight_input'));
        }
        break;

      case STATES.HEIGHT_INPUT:
        if (!validateWeight(input)) {
          res.send("CON " + getMessage(user.language, 'invalid_weight'));
          break;
        }
        await client.query(
          "UPDATE users SET current_state = $1 WHERE id = $2",
          [STATES.HEIGHT_INPUT, user.id]
        );
        res.send("CON " + getMessage(user.language, 'height_input'));
        break;

      case STATES.BMI_RESULT:
        if (!validateHeight(input)) {
          res.send("CON " + getMessage(user.language, 'invalid_height'));
          break;
        }
        const weight = parseFloat(steps[steps.length - 2]);
        const height = parseFloat(input);
        const bmi = calculateBMI(weight, height);
        const status = getBMIStatus(bmi, user.language);

        await client.query(
          "INSERT INTO results (user_id, weight, height, bmi) VALUES ($1, $2, $3, $4)",
          [user.id, weight, height, bmi]
        );

        await client.query(
          "UPDATE users SET current_state = $1 WHERE id = $2",
          [STATES.BMI_RESULT, user.id]
        );

        const message = `Your BMI is ${bmi}. ${status}\n${getMessage(user.language, 'tips_question')}`;
        res.send("CON " + message);
        break;

      case STATES.TIPS_SELECTION:
        if (input === "1") {
          const resultRes = await client.query(
            "SELECT * FROM results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
            [user.id]
          );
          const result = resultRes.rows[0];
          if (!result) {
            res.send("END " + getMessage(user.language, 'db_error'));
            break;
          }
          const tips = getBMITips(result.bmi, user.language);

          await client.query(
            "UPDATE users SET current_state = $1 WHERE id = $2",
            [STATES.PREVIOUS_RECORD, user.id]
          );

          res.send("END " + tips);
        } else if (input === "2") {
          await client.query(
            "UPDATE users SET current_state = $1 WHERE id = $2",
            [STATES.PREVIOUS_RECORD, user.id]
          );
          res.send("END " + getMessage(user.language, 'thank_you'));
        } else {
          res.send(
            "CON " +
            getMessage(user.language, 'invalid_input') +
            "\n" +
            getMessage(user.language, 'tips_question')
          );
        }
        break;

      case STATES.PREVIOUS_RECORD:
        const lastResultRes = await client.query(
          "SELECT * FROM results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
          [user.id]
        );
        const lastResult = lastResultRes.rows[0];

        if (lastResult) {
          const bmi = lastResult.bmi;
          const weight = lastResult.weight;
          const height = lastResult.height;
          const status = getBMIStatus(bmi, user.language);

          const msg = `Last BMI: ${bmi} (${status})\nWeight: ${weight}kg, Height: ${height}cm\n${getMessage(user.language, 'new_check')}`;
          res.send("CON " + msg);
        } else {
          await client.query(
            "UPDATE users SET current_state = $1 WHERE id = $2",
            [STATES.WEIGHT_INPUT, user.id]
          );
          res.send("CON " + getMessage(user.language, 'weight_input'));
        }
        break;

      case null:
        if (user) {
          await client.query(
            "UPDATE users SET current_state = $1 WHERE id = $2",
            [STATES.PREVIOUS_RECORD, user.id]
          );
        }
        res.send("END " + getMessage(user ? user.language : 'en', 'thank_you'));
        break;

      default:
        res.send("END " + getMessage(user ? user.language : 'en', 'invalid_input'));
    }

    client.release();
  } catch (error) {
    console.error("Application error:", error);
    res.send("END " + getMessage('en', 'db_error'));
  }
});

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`, req.body);
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`USSD BMI App running on http://localhost:${PORT}`);
});
