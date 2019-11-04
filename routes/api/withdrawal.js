const express = require("express");
const router = express.Router();
const models = require("../../models/");
const pool = require("../../config/database");
const {
	Item,
	Branch,
	Customer,
	Department,
	Withdrawal,
	Staff
} = models;
const { check, validationResult } = require("express-validator/check");
const utils = require("../../utils/query");
const stockStatus = require("./stock_status");
const { installItems, transferItems, lendItems, returnItems } = stockStatus;

router.get("/get-all", async (req, res) => {
	const {
		limit,
		page,
		search_col,
		search_term,
		from,
		to,
		install_from,
		install_to,
		return_from,
		return_to,
		type,
		status
	} = req.query;
	const q = await utils.query({
		limit,
		page,
		search_col,
		search_term,
		cols: `${Withdrawal.getColumns}, ${Branch.getColumns}, ${Customer.getColumns}, ${Staff.getColumns}, ${Department.getColumns}`,
		tables: `"withdrawal"
		LEFT OUTER JOIN "branch" ON "withdrawal"."for_branch_code" = "branch"."branch_code"
		LEFT OUTER JOIN "customer" ON "branch"."owner_customer_code" = "customer"."customer_code"
		LEFT OUTER JOIN "department" ON "withdrawal"."for_department_code" = "department"."department_code"
		JOIN "staff" ON "withdrawal"."created_by_staff_code" = "staff"."staff_code"
		`,
		where: Withdrawal.filter({
			from,
			to,
			install_from,
			install_to,
			return_from,
			return_to,
			type,
			status
		}),
		availableCols: [
			"customer_code",
			"customer_name",
			"branch_code",
			"branch_name",
			"staff_name",
			"department_code",
			"department_name"
		]
	});
	if (q.errors) {
		res.status(500).json(q);
	} else {
		res.json(q);
	}
});

router.get("/:id/details", async (req, res) => {
	const { id } = req.params;
	const q = await utils.findOne({
		cols: Customer.getColumns,
		tables: `"withdrawal"
		LEFT OUTER JOIN "branch" ON "withdrawal"."for_branch_code" = "branch"."branch_code"
		JOIN "customer" ON "customer"."customer_code" = "branch"."owner_customer_code"
		JOIN "staff" ON "staff"."staff_code" = "withdrawal"."created_by_staff_code"
		LEFT OUTER JOIN "department" ON "department"."department_code" = "withdrawal"."for_department_code"`,
		where: `"id" = ${id}`,
	});
	if (q.errors) {
		res.status(500).json(q);
	} else {
		res.json(q);
	}
});

router.get("/:id/items", async (req, res) => {
	const { limit, page, search_col, search_term, type, is_broken, status } = req.query;
	const { id } = req.params;
	const filters = Item.filter({
		status,
		is_broken,
		type
	});

	// TODO: Join with bulk, model, and vendor tables
	const q = await utils.query({
		limit,
		page,
		search_col,
		search_term,
		cols: `${Item.getColumns}`,
		tables: `"withdrawal_has_item"
		JOIN "item" ON "withdrawal_has_item"."serial_no" = "item"."serial_no"
		`,
		where: `"withdrawal_has_item"."withdrawal_id" = ${id} ${filters ? `AND ${filters}` : ""}`,
		availableCols: [
			"serial_no",
			"status",
		]
	});
	if (q.errors) {
		res.status(500).json(q);
	} else {
		res.json(q);
	}
});

const checkWithdrawal = [
	check("type")
		.isIn(["INSTALLATION", "LENDING", "TRANSFER"])
		.withMessage("Invalid or empty type."),
	check("created_by_staff_code")
		.not()
		.isEmpty()
		.withMessage("Staff must be provided."),
	check("date")
		.not()
		.isEmpty()
		.withMessage("Withdrawal date must be provided."),
];
const checkSerial = [
	check("serial_no")
		.isArray()
		.withMessage("Invalid Serial No.")
];

// Add Withdrawal
router.post("/add", checkWithdrawal, async (req, res) => {
	const validationErrors = validationResult(req);
	if (!validationErrors.isEmpty()) {
		return res.status(422).json({ errors: validationErrors.array() });
	}

	const {
		for_branch_code,
		for_department,
		created_by_staff_code,
		type,
		return_by,
		install_date,
		date,
		remarks,
	} = req.body;
	const moreValidation = await Withdrawal.validate({
		type,
		return_by,
		install_date,
		for_branch_code,
		for_department,
	});
	if (moreValidation.errors.length > 0) {
		res.status(400).send(moreValidation.errors);
		return;
	}

	const q = await utils.insert({
		table: "withdrawal",
		info: {
			for_branch_code: type === "TRANSFER" ? null : for_branch_code,
			for_department_code: type === "TRANSFER" ? for_department_code : null,
			created_by_staff_code,
			type,
			return_by: type === "LENDING" ? return_by : null,
			install_date: type === "INSTALLATION" ? install_date : null,
			status: "PENDING",
			remarks,
			date
		},
		returning: "id"
	})
	if (q.errors) {
		res.status(500).json(q);
	} else {
		res.json(q);
	}
});

// Edit Withdrawal (only if it is pending)
router.put("/:id/edit", checkWithdrawal, async (req, res) => {
	const validationErrors = validationResult(req);
	if (!validationErrors.isEmpty()) {
		return res.status(422).json({ errors: validationErrors.array() });
	}

	const { id } = req.params;
	const {
		for_branch_code,
		for_department_code,
		created_by_staff_code,
		type,
		return_by,
		date,
		install_date
	} = req.body;
	const moreValidation = await Withdrawal.validate({
		type,
		return_by,
		install_date,
		for_branch_code,
		for_department_code
	});
	if (moreValidation.errors.length > 0) {
		res.status(400).json({ errors: moreValidation.errors });
		return;
	}

	// Check if Pending
	const isPending = await Withdrawal.checkStatus(id, "PENDING");
	if (!isPending) {
		res.status(400).json({ errors: [{ msg: "This withdrawal must be PENDING." }] });
		return;
	}

	// Edit
	const q = await utils.update({
		table: "withdrawal",
		info: {
			for_branch_code: type === "TRANSFER" ? null : for_branch_code,
			for_department_code: type === "TRANSFER" ? for_department_code : null,
			created_by_staff_code,
			return_by: type === "LENDING" ? return_by : null,
			install_date: type === "INSTALLATION" ? install_date : null,
			date
		},
		where: `"id" = ${id}`,
		returning: "id"
	});
	if (q.errors) {
		res.status(500).json(q);
	} else {
		res.json(q);
	}
});

// Edit remarks (Can be edited regardless of status)
router.put("/:id/edit-remarks", async (req, res) => {
	const { id } = req.params;
	const { remarks } = req.body;

	const q = await update({
		table: "withdrawal",
		info: {
			remarks
		},
		where: `"id" = '${id}'`,
		returning: "id"
	});
	if (q.errors) {
		res.status(500).json(q);
	} else {
		res.json(q);
	}
});

// Change Status
router.put("/:id/change-status", async (req, res) => {
	const { id } = req.params;
	const { status } = req.body;

	const isPending = await Withdrawal.checkStatus(id, "PENDING");
	if (status == "CONFIRMED") {
		if (!isPending) {
			res.sendStatus(421);
			return;
		} else {
			const changeStatus = await confirmItems(id);

			if (changeStatus.length > 0) {
				res.status(500).send(changeStatus.errors);
			} else {
				res.sendStatus(200);
			}
		}
	} else if (status == "CANCELLED") {
		const changeStatus = await Withdrawal.changeStatus(id, status);
		if (changeStatus.errors.length > 0) {
			res.status(500).json({ errors: changeStatus.errors });
			return;
		} else {
			await pool.query(`
				BEGIN TRANSACTION [Trans1]
				BEGIN TRY
					UPDATE "item"
					SET "status" = 'IN_STOCK', "reserved_branch_code" = null
					FROM "withdrawal_has_item"
					WHERE "item"."serial_no" = "withdrawal_has_item"."serial_no" AND "withdrawal_id" = ${id}

					DELETE FROM "withdrawal_has_item"
					WHERE "withdrawal_id" = ${id}

					COMMIT TRANSACTION [Trans1]
				END TRY

				BEGIN CATCH
					ROLLBACK TRANSACTION [Tran1]
				END CATCH
			`).then(r => res.sendStatus(200))
			.catch(err => {
				res.status(400).json({ errors: err })
			})
		}
	} else if (status == "PENDING") {
		res.status(400).json({ errors: [{ msg: "Cannot change status to PENDING." }] });
	}
});

// Add items to withdrawal (pending only)
router.put("/:id/add-items", async (req, res) => {
	const { serial_no } = req.body;
	const { id } = req.params;

	// Get Branch Code
	let branch_code = "";

	const q = await utils.findOne({
		cols: Withdrawal.getColumns,
		tables: "withdrawal",
		where: `"id" = ${id}`,
	});
	branch_code = q.data.for_branch_code

	// Check if Pending
	const isPending = await Withdrawal.checkStatus(id, "PENDING");
	if (!isPending) {
		res.status(400).json([{ msg: "This withdrawal must be PENDING." }]);
		return;
	}

	let r = null;
	let errors = [];

	const type = await Withdrawal.getType(id);
	if (type.errors) {
		res.status(500).send(type.errors);
		return;
	}

	if (type === "INSTALLATION") {
		r = await installItems(serial_no, branch_code);
	} else if (type === "TRANSFER") {
		r = await transferItems(serial_no);
	} else if (type === "LENDING") {
		r = await lendItems(serial_no);
	} else {
		res.status(400).json({ errors: [{ msg: "Withdrawal type is invalid" }] });
		return;
	}
	errors = r.errors;

	await Promise.all(
		r.updatedSerials.map(async no => {
			const q = await utils.insert({
				table: "withdrawal_has_item",
				info: {
					withdrawal_id: id,
					serial_no: no
				}
			})
			if (q.errors) {
				errors.push({
					msg: `Item ${no} cannot be added to the withdrawal.`
				})
			}
		})
	);
	if (errors.length > 0) res.status(400).json({ errors });
	else res.sendStatus(200);
});

// Remove Items from Withdrawal (Pending only)
router.put("/:id/remove-items", checkSerial, async (req, res) => {
	const validationErrors = validationResult(req);
	if (!validationErrors.isEmpty()) {
		return res.status(422).json({ errors: validationErrors.array() });
	}

	const { serial_no } = req.body;
	const { id } = req.params;

	// Check if Pending
	const isPending = await Withdrawal.checkStatus(id, "PENDING");
	if (!isPending) {
		res.status(400).json({ errors: [{ msg: "This withdrawal must be PENDING." }] });
		return;
	}

	let errors = [];
	const r = await returnItems(serial_no);
	errors = r.errors;

	await Promise.all(
		r.updatedSerials.map(async no => {
			const q = await del({
				table: "withdrawal_has_item",
				where: `"withdrawal_id" = ${id} AND "serial_no" = '${serial_no}'`,
			});
			if (q.errors) {
				errors = q.errors
			}
		})
	);
	if (errors.length > 0) res.status(400).json({ errors });
	else res.sendStatus(200);
});

// Deleting withdrawals (can be done when it is cancelled).
removeAllItemsAndDelete = id => {
	return pool.query(`
		BEGIN TRANSACTION [Trans1]
			BEGIN TRY
				DELETE FROM "withdrawal_has_item"
				WHERE "withdrawal_id" = ${id}

				DELETE FROM "withdrawal
				WHERE "id" = ${id}

				COMMIT TRANSACTION [Trans1]
			END TRY

			BEGIN CATCH
      			ROLLBACK TRANSACTION [Trans1]
  			END CATCH  
	`).then(r => ({
			errors: []
		}))
		.catch(err => ({
			errors: [{ msg: "This withdrawal cannot be deleted." }]
		}));
};

// Delete Withdrawal (only if it is pending)
router.delete("/:id", async (req, res) => {
	const { id } = req.params;
	// Check if Cancelled
	const isCancelled = await Withdrawal.checkStatus(id, "CANCELLED");
	if (!isCancelled) {
		res.status(400).json({ errors: [{ msg: "This withdrawal must be CANCELLED." }] });
		return;
	}

	// Delete items from the withdrawal
	const r = await removeAllItemsAndDelete(id);
	if (r.errors.length > 0) {
		res.status(500).json(r.errors);
	} else {
		res.sendStatus(200);
	}
});

module.exports = router;
