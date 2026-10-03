// Credit balance changes. Balances are dollars with cents; every change is a
// compare-and-set on the exact current value, rounded to whole cents, so there
// is no float drift (8.85 - 2.95 - 2.95 stays 2.95) and no lost update when
// two requests change the same balance at once.
const User = require('../models/User');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * @param {string|ObjectId} userId
 * @param {number} delta   positive adds credits, negative charges
 * @param {{ allowNegative?: boolean }} opts
 * @returns {Promise<object|null>} the updated user, or null if funds are short / user missing
 */
async function adjustCredits(userId, delta, { allowNegative = false } = {}) {
  const d = round2(delta);
  for (let attempt = 0; attempt < 8; attempt++) {
    const user = await User.findById(userId, { credits: 1 }).lean();
    if (!user) return null;
    const current = user.credits || 0;
    const next = round2(current + d);
    if (next < 0 && !allowNegative) return null;
    const updated = await User.findOneAndUpdate({ _id: userId, credits: current }, { $set: { credits: next } }, { new: true });
    if (updated) return updated;
  }
  throw new Error('Credit balance is busy. Please try again.');
}

module.exports = { adjustCredits, round2 };
