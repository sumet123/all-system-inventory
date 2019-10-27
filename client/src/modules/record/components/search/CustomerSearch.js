import React from "react";
import SearchField from "../SearchField";
import { setSelectedObject } from "@/actions/record";
import { connect } from "react-redux";

class CustomerSearch extends React.Component {
	state = {
		showResults: false,
		customer: ""
	};
	render() {
		const { showResults, customer } = this.state;
		const { selectedCustomer, setSelectedObject, disabled } = this.props;
		return (
			<SearchField
				value={selectedCustomer ? selectedCustomer.name : customer}
				onChange={e => {
					this.setState({ customer: e.target.value });
					setSelectedObject({ selectedCustomer: null });
				}}
				placeholder="Customer Name"
				searchUrl="/customer/get-all"
				searchTerm={customer}
				searchName="customer_name"
				label="Customer"
				disabled={disabled}
				showResults={() => this.setState({ showResults: true })}
				hideResults={() => this.setState({ showResults: false })}
				list={data => (
					<div className={`${showResults || "is-hidden"}`}>
						<CustomerSearchList
							customers={data && data.rows}
							hideResults={() => this.setState({ showResults: false })}
						/>
					</div>
				)}
			/>
		);
	}
}

const List = ({ customers, setSelectedObject, hideResults }) => {
	return (
		<div className="panel menu dropdown" onClick={hideResults}>
			{customers ? (
				customers.length > 0 ? (
					customers.map((e, i) => (
						<span
							key={e.customer_name + i}
							className="list-item is-clickable"
							onClick={() =>
								setSelectedObject({ selectedCustomer: {
									customer_code: e.customer_code,
									name: e.customer_name
								}})
							}
						>
							{e.customer_name} ({e.customer_code})
						</span>
					))
				) : (
					<span className="list-item">ไม่พบรายการ</span>
				)
			) : (
				<span className="list-item">กรุณาพิมพ์อย่างน้อย 3 ตัวอักษรแล้วกดค้นหา</span>
			)}
		</div>
	);
};

const mapStateToProps = state => ({
	selectedCustomer: state.record.selectedCustomer
});
const mapDispatchToProps = {
	setSelectedObject
};

const CustomerSearchList = connect(
	null,
	mapDispatchToProps
)(List);

export default connect(
	mapStateToProps,
	mapDispatchToProps
)(CustomerSearch);
