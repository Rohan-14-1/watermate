const chickenTurnService = require("../services/chickenTurnService");

async function getChickenTurn(req, res, next) {
  try {
    const status = await chickenTurnService.getChickenStatus(
      req.group.id,
      req.user.id
    );
    res.json(status);
  } catch (err) {
    next(err);
  }
}

async function markChickenDone(req, res, next) {
  try {
    const result = await chickenTurnService.markChickenDone(
      req.group.id,
      req.user.id
    );
    res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        message: err.message,
        code: err.code || null,
      });
    }
    next(err);
  }
}

async function approveChicken(req, res, next) {
  try {
    const result = await chickenTurnService.approveChickenDelivery(
      req.group.id,
      req.user.id
    );
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        message: err.message,
        code: err.code || null,
      });
    }
    next(err);
  }
}

async function getChickenHistory(req, res, next) {
  try {
    const { page, pageSize } = req.query;
    const history = await chickenTurnService.getChickenHistory(
      req.group.id,
      page,
      pageSize
    );
    res.json(history);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getChickenTurn,
  markChickenDone,
  approveChicken,
  getChickenHistory,
};
