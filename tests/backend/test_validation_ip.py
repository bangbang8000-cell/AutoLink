"""4.5 D-3 IP 规划校验测试（F5-3：子网重叠/网关冲突/越界/重复/掩码合法性）"""
import pytest

from validation_engine import (
    validate_subnet, check_subnet_overlap, check_gateway_conflicts,
    check_allocations, check_ip_plan,
)


class TestValidateSubnet:
    """IP001 掩码/网段合法性"""

    @pytest.mark.parametrize('s', ['10.1.0.0/20', '10.0.0.0/8', '192.168.1.0/24', '10.1.16.1/20'])
    def test_valid(self, s):
        ok, _ = validate_subnet(s)
        assert ok is True

    @pytest.mark.parametrize('s', ['', None, '10.1.0.0/40', '300.1.1.0/24', '10.1.0.0', 'not-a-net'])
    def test_invalid(self, s):
        ok, reason = validate_subnet(s)
        assert ok is False
        assert reason


class TestCheckSubnetOverlap:
    """IP002 子网重叠"""

    def test_no_overlap(self):
        issues = check_subnet_overlap(['10.1.0.0/20', '10.1.16.0/20', '10.1.32.0/20'])
        assert issues == []

    def test_overlap_detected(self):
        issues = check_subnet_overlap(['10.1.0.0/16', '10.1.16.0/20'])
        assert len(issues) == 1
        assert issues[0].rule_id == 'IP002'
        assert issues[0].severity == 'error'

    def test_contained_detected(self):
        issues = check_subnet_overlap(['10.1.0.0/16', '10.1.0.0/24'])
        assert len(issues) == 1

    def test_invalid_ignored(self):
        issues = check_subnet_overlap(['10.1.0.0/40', '10.1.16.0/20'])
        assert issues == []


class TestCheckGatewayConflicts:
    """IP003 网关冲突"""

    def test_duplicate_gateway_in_segment(self):
        issues = check_gateway_conflicts({'10.1.16.0/20': ['10.1.16.1', '10.1.16.1']})
        ip003 = [i for i in issues if i.rule_id == 'IP003']
        assert len(ip003) == 1

    def test_gateway_out_of_segment(self):
        issues = check_gateway_conflicts({'10.1.16.0/20': ['10.2.0.1']})
        ip003 = [i for i in issues if i.rule_id == 'IP003']
        assert len(ip003) == 1
        assert '不在' in ip003[0].message

    def test_cross_segment_duplicate(self):
        issues = check_gateway_conflicts({
            '10.1.16.0/20': ['10.1.16.1'],
            '10.1.32.0/20': ['10.1.16.1'],
        })
        ip003 = [i for i in issues if i.rule_id == 'IP003']
        assert any('同时' in i.message for i in ip003)

    def test_valid_gateways_pass(self):
        issues = check_gateway_conflicts({'10.1.16.0/20': ['10.1.16.1', '10.1.16.2']})
        assert issues == []

    def test_invalid_gateway(self):
        issues = check_gateway_conflicts({'10.1.16.0/20': ['999.1.1.1']})
        assert any('不是合法' in i.message for i in issues)


class TestCheckAllocations:
    """IP004 越界 / IP005 重复"""

    def test_out_of_bounds(self):
        issues = check_allocations(
            [{'ip': '10.9.9.9', 'segment': '10.1.16.0/20', 'name': 'GW1'}],
            {'compute': '10.1.16.0/20'})
        ip004 = [i for i in issues if i.rule_id == 'IP004']
        assert len(ip004) == 1

    def test_duplicate_ip(self):
        issues = check_allocations([
            {'ip': '10.1.16.1', 'name': 'GW1'},
            {'ip': '10.1.16.1', 'name': 'GW2'},
        ], {'compute': '10.1.16.0/20'})
        ip005 = [i for i in issues if i.rule_id == 'IP005']
        assert len(ip005) == 1

    def test_valid_allocations_pass(self):
        issues = check_allocations([
            {'ip': '10.1.16.1', 'segment': '10.1.16.0/20', 'name': 'GW1'},
            {'ip': '10.1.16.2', 'segment': '10.1.16.0/20', 'name': 'GW2'},
        ], {'compute': '10.1.16.0/20'})
        assert issues == []

    def test_without_segment_falls_back_to_known_nets(self):
        issues = check_allocations(
            [{'ip': '10.1.16.5', 'name': 'GW1'}], {'compute': '10.1.16.0/20'})
        assert issues == []


class TestCheckIpPlan:
    """AIDC plan:table IP 规划整体校验"""

    def _plan(self, ip_segments, gateways=None):
        gateways = gateways if gateways is not None else ['10.1.16.1']
        return {
            'macro': {'ipSegments': ip_segments},
            'deviceList': [{'role': 'LEAF', 'gateways': gateways}],
            'allocations': [],
        }

    def test_plan_ip_segments_overlap(self):
        plan = self._plan({'loopback': '10.1.0.0/16', 'compute': '10.1.16.0/20'})
        issues = check_ip_plan(plan)
        assert 'IP002' in {i.rule_id for i in issues}

    def test_plan_invalid_mask(self):
        plan = self._plan({'loopback': '10.1.0.0/40', 'compute': '10.1.16.0/20'})
        issues = check_ip_plan(plan)
        assert 'IP001' in {i.rule_id for i in issues}

    def test_plan_gateway_out_of_segment(self):
        plan = self._plan({'compute': '10.1.16.0/20'},
                          gateways=['10.1.16.1', '10.2.0.1'])
        issues = check_ip_plan(plan)
        assert 'IP003' in {i.rule_id for i in issues}

    def test_plan_allocations_duplicate(self):
        plan = self._plan({'compute': '10.1.16.0/20'})
        plan['allocations'] = [
            {'ip': '10.1.16.2', 'segment': 'compute', 'name': 'S1'},
            {'ip': '10.1.16.2', 'segment': 'compute', 'name': 'S2'},
        ]
        issues = check_ip_plan(plan)
        assert 'IP005' in {i.rule_id for i in issues}

    def test_clean_plan_no_problems(self):
        plan = self._plan({
            'loopback': '10.1.0.0/20', 'compute': '10.1.16.0/20',
            'storage': '10.1.32.0/20', 'oob': '10.1.64.0/21',
        }, gateways=['10.1.16.1'])
        assert check_ip_plan(plan) == []

    def test_none_safe(self):
        assert check_ip_plan(None) == []
